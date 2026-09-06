import './style.css';
import heroUrl from './assets/botanical-checkin-hero.webp';
import type { ClassData, IssuedRoster, SessionData } from './types.ts';
import { api, dateTime, escapeHtml, relative, setStatus } from './utils.ts';
import { decryptExport, download, encryptExport, verifySignedCsv } from './crypto.ts';
import { initializeLicense, restoreLicense, type LicenseState } from './license.ts';

declare const __BUILD_SHA__: string;

interface DemoData {
  workspaceId: string;
  expiresIn: number;
  sampleToken: string;
  class: ClassData;
  session: SessionData;
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const demoStorageKey = 'demo:pcc:workspace';
let license: LicenseState = { unlocked: false };
let pollTimer = 0;

const header = () => `
  <header><div class="nav">
    <a class="brand" href="/" data-route aria-label="Privacy Class Check-in home"><i class="brand-mark" aria-hidden="true"></i><span>Privacy Class Check-in</span></a>
    <nav aria-label="Main navigation"><ul><li><a href="/demo" data-route>Demo</a></li><li><a href="/#check-in">Check in</a></li><li><a href="/#teacher">Teacher</a></li><li><a href="/privacy" data-route>Privacy</a></li></ul></nav>
  </div></header>
  <div id="offline" class="offline" role="status" hidden>You’re offline. Saved pages remain available, but live check-ins need a connection.</div>`;

const demoBanner = () => `
  <aside class="demo-banner" aria-label="Demo status"><strong>Demo — sample data, nothing is saved</strong><span class="demo-actions"><button class="text-button" id="reset-demo" type="button">Reset demo</button><button class="text-button" id="start-real" type="button">Start for real</button></span></aside>`;

const footer = () => `
  <footer><div class="foot"><span>Private attendance for small classes. Botanical artwork is AI-assisted and original.</span><ul><li><a href="/open-export" data-route>Open export</a></li><li><a href="/privacy" data-route>Privacy</a></li><li><a href="/terms" data-route>Terms</a></li><li><a href="https://github.com/B-Divyesh/sf-privacy-class-checkin" target="_blank" rel="noreferrer">Source (opens new tab)</a></li></ul><span>Built by Param Factory · Build ${escapeHtml(__BUILD_SHA__.slice(0, 12))}</span></div></footer>
  <div id="route-status" class="visually-hidden" role="status" aria-live="polite"></div><div id="global-status" class="status-live" role="status" aria-live="polite"></div>`;

const layout = (main: string, demo = false) => `${header()}${demo ? demoBanner() : ''}<main id="main" tabindex="-1">${main}</main>${footer()}`;

function setMeta(title: string, description: string, path: string) {
  document.title = title;
  const canonical = `https://privacy-class-checkin.sociobot.in${path}`;
  document.querySelector<HTMLMetaElement>('meta[name="description"]')!.content = description;
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')!.href = canonical;
  document.querySelector<HTMLMetaElement>('meta[property="og:title"]')!.content = title;
  document.querySelector<HTMLMetaElement>('meta[property="og:description"]')!.content = description;
  document.querySelector<HTMLMetaElement>('meta[property="og:url"]')!.content = canonical;
  document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')!.content = title;
  document.querySelector<HTMLMetaElement>('meta[name="twitter:description"]')!.content = description;
}

function bindCommon() {
  const offline = document.querySelector<HTMLElement>('#offline');
  if (offline) offline.hidden = navigator.onLine;
}

function focusPage() {
  requestAnimationFrame(() => {
    const heading = document.querySelector<HTMLElement>('main h1');
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
    document.querySelector<HTMLElement>('#route-status')!.textContent = heading.textContent ?? 'Page loaded';
    window.scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
}

function navigate(path: string) {
  history.pushState({}, '', path);
  void renderRoute(true);
}

function landing() {
  setMeta('Privacy Class Check-in — record attendance privately', 'Teachers record attendance with rotating codes and pseudonymous tokens, without location, biometrics, or student accounts.', '/');
  app.innerHTML = layout(`
    <section class="shell hero"><div class="hero-copy"><p class="eyebrow">Private classroom attendance</p><h1>Record class attendance without tracking</h1><p class="lede">For teachers running small classes, rotating codes record a check-in without GPS, biometrics, or student accounts.</p>
      <div class="hero-actions"><a class="btn" href="/demo" data-route>Try it with sample data</a><a class="btn secondary" href="#teacher">Set up your class</a></div><p class="action-note">The sample opens a filled 30-learner class. Nothing is saved.</p>
      <ul class="fact-list"><li><strong>Privacy:</strong> no names, location, biometrics, or analytics.</li><li><strong>Offline:</strong> saved pages open; live check-ins need a connection.</li><li><strong>Price:</strong> core check-in is free. Printable cards cost $29 once.</li></ul></div>
      <figure class="hero-plate"><i class="pin" aria-hidden="true"></i><img src="${heroUrl}" width="1152" height="768" fetchpriority="high" decoding="async" alt="Pressed fern fronds, blank attendance tags, and a pencil on warm paper"><figcaption>Blank tags represent pseudonyms instead of student identities.</figcaption></figure>
    </section>
    <section id="check-in" class="section"><div class="section-inner role-grid"><div><p class="eyebrow">Learner check-in</p><h2>Enter your class code and token</h2><p>Your teacher shows a six-digit code and gives you a private roster token. A check-in is not proof of identity or location.</p></div>
      <form id="checkin-form" class="sheet" novalidate><div class="field"><label for="code">Current session code</label><input class="input" id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required aria-describedby="code-help"><small id="code-help">Enter the six digits shown by your teacher.</small></div><div class="field"><label for="token">Your roster token</label><input class="input" id="token" name="token" autocapitalize="none" autocomplete="off" spellcheck="false" required aria-describedby="token-help"><small id="token-help">Use the private token issued for this class.</small></div><p id="checkin-error" class="error" role="alert"></p><button class="btn" type="submit">Record my check-in</button></form>
    </div></section>
    <section class="section"><div class="section-inner"><p class="eyebrow">How it works</p><h2>Run one attendance session</h2><div class="grid-3"><article class="step"><b>01</b><h3>Issue pseudonymous tokens</h3><p>Use labels such as “Fern 12.” The server stores one-way hashes of teacher keys and tokens.</p></article><article class="step"><b>02</b><h3>Show a rotating code</h3><p>Start a session and display its six digits. Close the session to stop learner check-ins.</p></article><article class="step"><b>03</b><h3>Review and export</h3><p>Make keyboard-friendly corrections, then download a signed CSV encrypted with your passphrase.</p></article></div></div></section>
    <section class="section principle"><div class="section-inner"><div><p class="eyebrow">Privacy limits</p><h2>Know what this record can prove</h2><p>The record shows that someone used a current code and valid token. It does not prove identity or physical presence.</p></div><ul class="not-list"><li>No GPS or geofencing</li><li>No camera, face, or fingerprint</li><li>No student accounts or device fingerprinting</li><li>No continuous tracking</li></ul></div></section>
    <section id="teacher" class="section"><div class="section-inner role-grid"><div><p class="eyebrow">Teacher setup</p><h2>Set up a private class</h2><p>Enter pseudonyms, one per line. Avoid names, emails, student IDs, or labels that identify a learner.</p><div class="callout"><strong>Save issued tokens when they appear.</strong> The server cannot return readable tokens after setup.</div></div>
      <form id="class-form" class="sheet" novalidate><div class="field"><label for="class-name">Class label</label><input class="input" id="class-name" name="className" maxlength="80" required></div><div class="field"><label for="roster">Pseudonyms, one per line</label><textarea class="input" id="roster" name="roster" required aria-describedby="roster-help"></textarea><small id="roster-help">Add 1–60 distinct pseudonyms.</small></div><div class="field"><label for="retention">Delete class data after</label><select class="input" id="retention" name="retentionDays"><option value="7">7 days</option><option value="30" selected>30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></div><p id="class-error" class="error" role="alert"></p><button class="btn" type="submit">Create private class</button></form>
    </div></section>
    <section class="section"><div class="section-inner role-grid"><div><p class="eyebrow">Teacher recovery</p><h2>Open an existing class</h2><p>Use the class ID and teacher key from your saved recovery link.</p></div><form id="open-form" class="sheet"><div class="field"><label for="open-id">Class ID</label><input class="input" id="open-id" autocomplete="off" required></div><div class="field"><label for="open-key">Teacher key</label><input class="input" id="open-key" autocomplete="off" required></div><p id="open-error" class="error" role="alert"></p><button class="btn" type="submit">Open class</button></form></div></section>
    <section class="section"><div class="section-inner role-grid"><div><p class="eyebrow">Printable cards</p><h2>Add printable token cards for $29</h2><p>This one-time license adds print layouts. Check-in, manual correction, deletion, and exports remain free.</p><p class="callout"><strong>Checkout registration is pending.</strong> Purchase is not available yet. Existing license holders can restore access.</p></div><div class="license-box"><h3>${license.unlocked ? 'Printable cards are active' : 'Restore a license'}</h3>${license.notice ? `<p class="callout">${escapeHtml(license.notice)}</p>` : ''}${license.unlocked ? '<p>This browser can print token cards from a teacher dashboard.</p>' : '<form id="license-form"><div class="field"><label for="license-token">License token</label><input class="input" id="license-token" autocomplete="off" required></div><button class="btn secondary" type="submit">Verify saved license</button></form>'}</div></div></section>`);
  bindCommon();
  bindLandingForms();
}

function bindLandingForms() {
  document.querySelector<HTMLFormElement>('#checkin-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const error = form.querySelector<HTMLElement>('#checkin-error')!;
    const button = form.querySelector<HTMLButtonElement>('button')!;
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Recording…';
    const values = new FormData(form);
    try {
      const result = await api<{ alias: string; status: string; recorded: boolean }>('/api/checkins', { method: 'POST', body: JSON.stringify({ code: values.get('code'), token: values.get('token') }) });
      form.innerHTML = `<div class="success"><strong>${result.recorded ? 'Check-in recorded.' : 'Already checked in.'}</strong><br>${escapeHtml(result.alias)} is marked ${escapeHtml(result.status)}.</div><button class="btn secondary" type="button" id="another">Check in another token</button>`;
      form.querySelector('#another')?.addEventListener('click', landing);
    } catch (caught) {
      error.textContent = (caught as Error).message;
      button.disabled = false;
      button.textContent = 'Record my check-in';
    }
  });
  document.querySelector<HTMLFormElement>('#class-form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const error = form.querySelector<HTMLElement>('#class-error')!;
    const button = form.querySelector<HTMLButtonElement>('button')!;
    const values = new FormData(form);
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Creating class…';
    try {
      const roster = String(values.get('roster')).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const created = await api<{ classId: string; teacherKey: string; roster: IssuedRoster[] }>('/api/classes', { method: 'POST', body: JSON.stringify({ className: values.get('className'), roster, retentionDays: Number(values.get('retentionDays')) }) });
      localStorage.setItem(`pcc:key:${created.classId}`, created.teacherKey);
      localStorage.setItem(`pcc:tokens:${created.classId}`, JSON.stringify(created.roster));
      navigate(`/?class=${encodeURIComponent(created.classId)}&new=1`);
    } catch (caught) {
      error.textContent = (caught as Error).message;
      button.disabled = false;
      button.textContent = 'Create private class';
    }
  });
  document.querySelector<HTMLFormElement>('#open-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const id = document.querySelector<HTMLInputElement>('#open-id')!.value.trim();
    const key = document.querySelector<HTMLInputElement>('#open-key')!.value.trim();
    if (!id || !key) { document.querySelector<HTMLElement>('#open-error')!.textContent = 'Enter both values from the recovery link.'; return; }
    localStorage.setItem(`pcc:key:${id}`, key);
    navigate(`/?class=${encodeURIComponent(id)}`);
  });
  document.querySelector<HTMLFormElement>('#license-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    try { restoreLicense(document.querySelector<HTMLInputElement>('#license-token')!.value); location.reload(); }
    catch (caught) { setStatus((caught as Error).message, 'bad'); }
  });
}

async function teacherPage(classId: string) {
  const params = new URLSearchParams(location.search);
  const returnedKey = params.get('key');
  if (returnedKey) { localStorage.setItem(`pcc:key:${classId}`, returnedKey); params.delete('key'); history.replaceState({}, '', `/?${params}`); }
  const key = localStorage.getItem(`pcc:key:${classId}`) || '';
  if (!key) { teacherKeyPrompt(classId); return; }
  setMeta('Teacher dashboard — Privacy Class Check-in', 'Manage one private class attendance session.', '/');
  app.innerHTML = layout('<div class="shell"><h1 class="page-title">Open the teacher dashboard</h1><p role="status">Loading class records…</p></div>');
  bindCommon();
  try {
    const data = await api<ClassData>(`/api/classes/${classId}`, { headers: { 'x-teacher-key': key } });
    const requested = params.get('session');
    const active = data.sessions.find((session) => !session.closedAt && session.endsAt > Date.now() / 1000);
    renderTeacher(data, key, requested || active?.id || data.sessions[0]?.id, params.get('new') === '1');
  } catch (caught) {
    app.innerHTML = layout(`<div class="shell narrow"><div class="sheet"><p class="eyebrow">Teacher access</p><h1 class="page-title">Couldn’t open this class</h1><p class="error">${escapeHtml((caught as Error).message)}</p><p>Check the recovery link, or enter the teacher key again.</p><div class="toolbar"><button class="btn" id="retry-key" type="button">Enter teacher key</button><a class="btn secondary" href="/" data-route>Return home</a></div></div></div>`);
    document.querySelector('#retry-key')?.addEventListener('click', () => { localStorage.removeItem(`pcc:key:${classId}`); teacherKeyPrompt(classId); });
  }
}

function teacherKeyPrompt(classId: string) {
  setMeta('Teacher access — Privacy Class Check-in', 'Enter a saved teacher key to open a private class.', '/');
  app.innerHTML = layout(`<div class="shell narrow"><form class="sheet" id="key-form"><p class="eyebrow">Teacher access</p><h1 class="page-title">Enter the teacher key</h1><p>Use the key from your saved recovery link. It stays on this device.</p><div class="field"><label for="teacher-key">Teacher key</label><input class="input" id="teacher-key" required autocomplete="off"></div><p class="error" id="key-error" role="alert"></p><button class="btn">Open class</button></form></div>`);
  bindCommon();
  document.querySelector<HTMLFormElement>('#key-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = document.querySelector<HTMLInputElement>('#teacher-key')!.value.trim();
    if (!key) { document.querySelector<HTMLElement>('#key-error')!.textContent = 'Enter the key from the recovery link.'; return; }
    localStorage.setItem(`pcc:key:${classId}`, key);
    void teacherPage(classId);
  });
}

function renderTeacher(data: ClassData, key: string, sessionId?: string, isNew = false) {
  clearInterval(pollTimer);
  const tokens = readTokens(data.id);
  const recovery = `${location.origin}/?class=${data.id}&key=${key}`;
  app.innerHTML = layout(`<div class="shell"><p class="eyebrow">Teacher dashboard</p><h1 class="page-title">${escapeHtml(data.name)}</h1><p class="lede">${data.roster.length} pseudonymous roster entries · deleted after ${data.retentionDays} days</p>
    ${isNew ? '<div class="success"><strong>Your class is ready.</strong> Save the recovery link and issue each token once.</div>' : ''}
    <details ${isNew ? 'open' : ''} class="sheet"><summary><strong>Recovery link and issued tokens</strong></summary><div class="field"><label for="recovery">Private teacher recovery link</label><input class="input" id="recovery" readonly value="${escapeHtml(recovery)}"><small>Anyone with this link can manage the class. Store it like a password.</small></div><div class="toolbar"><button class="btn secondary" type="button" id="copy-recovery">Copy recovery link</button>${tokens.length ? '<button class="btn quiet" type="button" id="download-tokens">Download token list</button>' : ''}</div>${tokens.length ? tokenCards(tokens) : '<p class="callout">Readable tokens are not on this device. The server cannot recover them.</p>'}${tokens.length && license.unlocked ? '<button class="btn no-print" type="button" id="print-cards">Print token cards</button>' : tokens.length ? '<p>Printable card layouts require the $29 one-time license. The token download remains free.</p>' : ''}</details>
    <section class="dashboard-section" aria-labelledby="session-title"><p class="eyebrow">Current session</p><h2 id="session-title">Attendance session</h2><div id="session-area">${sessionId ? '<p role="status">Loading session…</p>' : startSessionForm()}</div></section><section class="dashboard-section" aria-labelledby="history-title"><h2 id="history-title">Recent sessions</h2>${historyList(data)}</section><section class="danger-zone"><h2>Delete retained data</h2><p>Remove this class, roster hashes, sessions, and check-ins now. This cannot be undone.</p><button class="btn danger" type="button" id="delete-class">Delete this class…</button></section></div>`);
  bindCommon();
  bindTeacherBase(data, key);
  if (sessionId) void loadSession(data, key, sessionId); else bindStart(data, key);
}

function tokenCards(tokens: IssuedRoster[]) { return `<div class="token-grid" aria-label="Issued roster tokens">${tokens.map((item) => `<div class="token-card"><b>${escapeHtml(item.alias)}</b><code>${escapeHtml(item.token)}</code><small>Keep private · ${escapeHtml(location.host)}</small></div>`).join('')}</div>`; }
function readTokens(id: string): IssuedRoster[] { try { return JSON.parse(localStorage.getItem(`pcc:tokens:${id}`) || '[]') as IssuedRoster[]; } catch { return []; } }
function historyList(data: ClassData) { if (!data.sessions.length) return '<div class="empty">No sessions yet. Start one above when class begins.</div>'; return `<ul>${data.sessions.map((session) => `<li><a href="/?class=${data.id}&session=${session.id}">${dateTime(session.startedAt)}</a> — ${session.closedAt ? 'closed' : session.endsAt > Date.now() / 1000 ? 'active' : 'ended'}</li>`).join('')}</ul>`; }
function startSessionForm() { return `<form id="start-form" class="sheet narrow"><div class="form-row"><div class="field"><label for="late">Mark late after</label><select id="late" name="lateAfterMinutes" class="input"><option value="5">5 minutes</option><option value="10" selected>10 minutes</option><option value="15">15 minutes</option><option value="30">30 minutes</option></select></div><div class="field"><label for="duration">End session after</label><select id="duration" name="durationMinutes" class="input"><option value="30">30 minutes</option><option value="60" selected>1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option></select></div></div><p class="error" id="start-error" role="alert"></p><button class="btn" type="submit">Start rotating code</button></form>`; }

function bindTeacherBase(data: ClassData, key: string) {
  document.querySelector('#copy-recovery')?.addEventListener('click', async () => { await navigator.clipboard.writeText(document.querySelector<HTMLInputElement>('#recovery')!.value); setStatus('Recovery link copied.', 'good'); });
  document.querySelector('#download-tokens')?.addEventListener('click', () => { const rows = readTokens(data.id).map((item) => `${JSON.stringify(item.alias)},${JSON.stringify(item.token)}`).join('\r\n'); download(new Blob([`pseudonym,token\r\n${rows}\r\n`], { type: 'text/csv' }), `${safeName(data.name)}-tokens.csv`); });
  document.querySelector('#print-cards')?.addEventListener('click', () => window.print());
  document.querySelector('#delete-class')?.addEventListener('click', async () => {
    if (!confirm(`Permanently delete “${data.name}” and every check-in? This cannot be undone.`)) return;
    try { await api(`/api/classes/${data.id}`, { method: 'DELETE', headers: { 'x-teacher-key': key } }); localStorage.removeItem(`pcc:key:${data.id}`); localStorage.removeItem(`pcc:tokens:${data.id}`); navigate('/'); }
    catch (caught) { setStatus((caught as Error).message, 'bad'); }
  });
}

function bindStart(data: ClassData, key: string) {
  document.querySelector<HTMLFormElement>('#start-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const error = form.querySelector<HTMLElement>('#start-error')!;
    const button = form.querySelector<HTMLButtonElement>('button')!;
    const values = new FormData(form);
    error.textContent = '';
    button.disabled = true;
    button.textContent = 'Starting…';
    try { const result = await api<{ sessionId: string }>(`/api/classes/${data.id}/sessions`, { method: 'POST', headers: { 'x-teacher-key': key }, body: JSON.stringify({ lateAfterMinutes: Number(values.get('lateAfterMinutes')), durationMinutes: Number(values.get('durationMinutes')) }) }); history.replaceState({}, '', `/?class=${data.id}&session=${result.sessionId}`); void loadSession(data, key, result.sessionId); }
    catch (caught) { error.textContent = (caught as Error).message; button.disabled = false; button.textContent = 'Start rotating code'; }
  });
}

async function loadSession(data: ClassData, key: string, sessionId: string) {
  try { const session = await api<SessionData>(`/api/classes/${data.id}/sessions/${sessionId}`, { headers: { 'x-teacher-key': key } }); renderSession(data, key, session); if (session.active) { clearInterval(pollTimer); pollTimer = window.setInterval(() => void refreshSession(data, key, sessionId), 10_000); } }
  catch (caught) { document.querySelector<HTMLElement>('#session-area')!.innerHTML = `<div class="callout"><strong>Could not load the session.</strong><br>${escapeHtml((caught as Error).message)}</div>${startSessionForm()}`; bindStart(data, key); }
}

async function refreshSession(data: ClassData, key: string, id: string) { try { renderSession(data, key, await api<SessionData>(`/api/classes/${data.id}/sessions/${id}`, { headers: { 'x-teacher-key': key } })); } catch (caught) { setStatus((caught as Error).message, 'bad'); } }

function renderSession(data: ClassData, key: string, session: SessionData) {
  const area = document.querySelector<HTMLElement>('#session-area');
  if (!area) return;
  area.innerHTML = `${session.active ? codeBoard(session) : `<div class="callout"><strong>Session ${session.closedAt ? 'closed' : 'ended'}.</strong> Manual corrections and exports remain available.</div>`}${metrics(countStatuses(session))}<div class="toolbar no-print">${session.active ? '<button class="btn danger" type="button" id="close-session">Close session</button>' : ''}<button class="btn secondary" type="button" id="refresh-session">Refresh records</button></div>${rosterTable(session, false)}<div class="sheet export-panel"><h2>Download a signed attendance export</h2><p>Encryption happens on this device. The passphrase is not sent or stored.</p><div class="field"><label for="export-pass">Export passphrase</label><input type="password" class="input" id="export-pass" minlength="8" autocomplete="new-password" aria-describedby="pass-help"><small id="pass-help">Use at least 8 characters and keep it separately.</small></div><p id="export-error" class="error" role="alert"></p><div class="toolbar"><button class="btn" type="button" id="encrypted-export">Download encrypted CSV</button><button class="btn quiet" type="button" id="plain-export">Download unencrypted CSV…</button></div></div>`;
  bindSessionControls(area, data, key, session);
}

function countStatuses(session: SessionData) { const counts = { present: 0, late: 0, absent: 0 }; session.roster.forEach((entry) => counts[entry.status]++); return counts; }
const metrics = (counts: { present: number; late: number; absent: number }) => `<div class="metrics" aria-label="Attendance totals"><div class="metric present"><b>${counts.present}</b><span>Present</span></div><div class="metric late"><b>${counts.late}</b><span>Late</span></div><div class="metric absent"><b>${counts.absent}</b><span>Absent</span></div></div>`;
const codeBoard = (session: SessionData) => `<div class="code-board"><span class="eyebrow">Current learner code</span><div class="code" aria-label="Session code ${session.code.split('').join(' ')}">${session.code}</div><p class="code-meta">Changes in about ${session.codeExpiresIn} seconds · ${relative(session.endsAt)}</p></div>`;

function rosterTable(session: SessionData, demo: boolean) {
  return `<div class="sheet roster-sheet"><h2>Roster marks</h2><p class="plain-note">Manual changes are labelled in the signed export. Each status control works by keyboard.</p><div class="table-scroll"><table><thead><tr><th>Pseudonym</th><th>Status</th><th>Recorded</th><th>Method</th></tr></thead><tbody>${session.roster.map((entry) => `<tr><td data-label="Pseudonym"><strong>${escapeHtml(entry.alias)}</strong></td><td data-label="Status"><label class="visually-hidden" for="${demo ? 'demo-' : ''}status-${entry.id}">Status for ${escapeHtml(entry.alias)}</label><select id="${demo ? 'demo-' : ''}status-${entry.id}" data-roster="${entry.id}"><option value="present" ${entry.status === 'present' ? 'selected' : ''}>Present</option><option value="late" ${entry.status === 'late' ? 'selected' : ''}>Late</option><option value="absent" ${entry.status === 'absent' ? 'selected' : ''}>Absent</option></select></td><td data-label="Recorded">${entry.checkedAt ? dateTime(entry.checkedAt) : '—'}</td><td data-label="Method">${entry.source ? escapeHtml(entry.source) : '—'}</td></tr>`).join('')}</tbody></table></div></div>`;
}

function bindSessionControls(area: HTMLElement, data: ClassData, key: string, session: SessionData) {
  area.querySelectorAll<HTMLSelectElement>('select[data-roster]').forEach((select) => select.addEventListener('change', async () => { select.disabled = true; try { await api(`/api/classes/${data.id}/sessions/${session.id}/roster/${select.dataset.roster}`, { method: 'PUT', headers: { 'x-teacher-key': key }, body: JSON.stringify({ status: select.value }) }); setStatus('Manual status saved.', 'good'); await refreshSession(data, key, session.id); } catch (caught) { setStatus((caught as Error).message, 'bad'); select.disabled = false; } }));
  area.querySelector('#refresh-session')?.addEventListener('click', () => void refreshSession(data, key, session.id));
  area.querySelector('#close-session')?.addEventListener('click', async () => { if (!confirm('Close this session? The code will stop accepting check-ins.')) return; try { await api(`/api/classes/${data.id}/sessions/${session.id}/close`, { method: 'POST', headers: { 'x-teacher-key': key }, body: '{}' }); clearInterval(pollTimer); await refreshSession(data, key, session.id); } catch (caught) { setStatus((caught as Error).message, 'bad'); } });
  area.querySelector('#encrypted-export')?.addEventListener('click', async () => { const error = area.querySelector<HTMLElement>('#export-error')!; error.textContent = ''; try { const csv = await fetchCsv(data.id, session.id, key); const encrypted = await encryptExport(csv, area.querySelector<HTMLInputElement>('#export-pass')!.value); download(encrypted, `${safeName(data.name)}-${session.startedAt}.attendance.pcc`); setStatus('Encrypted export downloaded. Keep the passphrase separately.', 'good'); } catch (caught) { error.textContent = (caught as Error).message; } });
  area.querySelector('#plain-export')?.addEventListener('click', async () => { if (!confirm('Download an unencrypted roster export? Anyone with the file can read it.')) return; try { download(new Blob([await fetchCsv(data.id, session.id, key)], { type: 'text/csv' }), `${safeName(data.name)}-${session.startedAt}.csv`); } catch (caught) { setStatus((caught as Error).message, 'bad'); } });
}

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'attendance';
async function fetchCsv(classId: string, sessionId: string, key: string) { const response = await fetch(`/api/classes/${classId}/sessions/${sessionId}/export`, { headers: { 'x-teacher-key': key } }); if (!response.ok) { let message = 'Export failed.'; try { message = (await response.json()).error || message; } catch { /* keep fallback */ } throw new Error(message); } return response.text(); }

async function demoPage(reset = false) {
  clearInterval(pollTimer);
  setMeta('Demo — Privacy Class Check-in', 'Try a filled 30-learner attendance session without saving class data.', '/demo');
  app.innerHTML = layout('<div class="shell"><h1 class="page-title">Review a sample attendance session</h1><p role="status">Loading sample data…</p></div>', true);
  bindCommon(); bindDemoBanner();
  let workspace = sessionStorage.getItem(demoStorageKey);
  if (reset && workspace) { await fetch(`/api/demo/${encodeURIComponent(workspace)}`, { method: 'DELETE' }).catch(() => undefined); sessionStorage.removeItem(demoStorageKey); workspace = null; }
  try {
    let response = workspace ? await fetch(`/api/demo/${encodeURIComponent(workspace)}`) : await fetch('/api/demo', { method: 'POST' });
    if (response.status === 404) { sessionStorage.removeItem(demoStorageKey); response = await fetch('/api/demo', { method: 'POST' }); }
    if (!response.ok) throw new Error('The sample could not load. Wait a moment and reset the demo.');
    const data = await response.json() as DemoData;
    sessionStorage.setItem(demoStorageKey, data.workspaceId);
    renderDemo(data);
  } catch (caught) { app.innerHTML = layout(`<div class="shell narrow"><h1 class="page-title">The sample could not load</h1><p class="error">${escapeHtml((caught as Error).message)}</p><button class="btn" id="reset-demo" type="button">Reset demo</button></div>`, true); bindDemoBanner(); }
}

function renderDemo(data: DemoData) {
  clearInterval(pollTimer);
  app.innerHTML = layout(`<div class="shell demo-shell" data-workspace="${escapeHtml(data.workspaceId)}"><p class="eyebrow">Sample teacher dashboard</p><h1 class="page-title">Review a sample attendance session</h1><p class="lede">Tuesday science lab has 30 pseudonymous learners and a realistic mix of attendance marks.</p>${codeBoard(data.session)}${metrics(countStatuses(data.session))}
    <section class="sample-checkin" aria-labelledby="sample-checkin-title"><div><h2 id="sample-checkin-title">Try one learner check-in</h2><p>Use the current sample code and token. This changes only the temporary sample.</p></div><form id="demo-checkin-form" class="sheet"><div class="field"><label for="demo-code">Sample code</label><input class="input" id="demo-code" name="code" value="${escapeHtml(data.session.code)}" readonly></div><div class="field"><label for="demo-token">Sample roster token</label><input class="input" id="demo-token" name="token" value="${escapeHtml(data.sampleToken)}" readonly></div><p class="error" id="demo-checkin-error" role="alert"></p><button class="btn" type="submit">Record sample check-in</button></form></section>
    ${rosterTable(data.session, true)}<section class="sheet export-panel" aria-labelledby="demo-export-title"><h2 id="demo-export-title">Download the sample export</h2><p>The signed CSV can be encrypted on this device with a passphrase.</p><div class="field"><label for="demo-export-pass">Export passphrase</label><input class="input" id="demo-export-pass" type="password" minlength="8" autocomplete="new-password"></div><p class="error" id="demo-export-error" role="alert"></p><button class="btn" id="demo-export" type="button">Download encrypted sample</button></section></div>`, true);
  bindCommon(); bindDemoBanner();
  document.querySelectorAll<HTMLSelectElement>('select[data-roster]').forEach((select) => select.addEventListener('change', async () => { select.disabled = true; try { await api(`/api/demo/${data.workspaceId}/roster/${select.dataset.roster}`, { method: 'PUT', body: JSON.stringify({ status: select.value }) }); await refreshDemo(data.workspaceId); setStatus('Sample status changed.', 'good'); } catch (caught) { setStatus((caught as Error).message, 'bad'); select.disabled = false; } }));
  document.querySelector<HTMLFormElement>('#demo-checkin-form')!.addEventListener('submit', async (event) => { event.preventDefault(); const error = document.querySelector<HTMLElement>('#demo-checkin-error')!; error.textContent = ''; try { const values = new FormData(event.currentTarget as HTMLFormElement); const result = await api<{ recorded: boolean }>(`/api/demo/${data.workspaceId}/checkins`, { method: 'POST', body: JSON.stringify({ code: values.get('code'), token: values.get('token') }) }); await refreshDemo(data.workspaceId); setStatus(result.recorded ? 'Sample check-in recorded.' : 'The sample token was already checked in.', 'good'); } catch (caught) { error.textContent = (caught as Error).message; } });
  document.querySelector('#demo-export')!.addEventListener('click', async () => { const error = document.querySelector<HTMLElement>('#demo-export-error')!; error.textContent = ''; try { const response = await fetch(`/api/demo/${data.workspaceId}/export`); if (!response.ok) throw new Error('The sample export could not be prepared. Reset the demo and try again.'); const encrypted = await encryptExport(await response.text(), document.querySelector<HTMLInputElement>('#demo-export-pass')!.value); download(encrypted, 'sample-attendance.attendance.pcc'); setStatus('Encrypted sample downloaded.', 'good'); } catch (caught) { error.textContent = (caught as Error).message; } });
  pollTimer = window.setInterval(() => void refreshDemo(data.workspaceId), 10_000);
}

async function refreshDemo(workspace: string) { const response = await fetch(`/api/demo/${workspace}`); if (!response.ok) throw new Error('The sample expired. Reset the demo to continue.'); renderDemo(await response.json() as DemoData); }

function bindDemoBanner() {
  document.querySelector('#reset-demo')?.addEventListener('click', () => void demoPage(true));
  document.querySelector('#start-real')?.addEventListener('click', async () => { const workspace = sessionStorage.getItem(demoStorageKey); if (workspace) await fetch(`/api/demo/${workspace}`, { method: 'DELETE' }).catch(() => undefined); sessionStorage.removeItem(demoStorageKey); navigate('/#teacher'); requestAnimationFrame(() => document.querySelector<HTMLElement>('#teacher h2')?.focus()); });
}

function legalPage(kind: 'privacy' | 'terms') {
  const privacy = `<h1 class="page-title">How we handle class data</h1><p class="lede">This service stores only the information needed for a short attendance record.</p><h2>Data the service stores</h2><ul><li>A class label, pseudonymous roster labels, and one-way hashes of roster tokens.</li><li>Session times, attendance marks, correction labels, and server timestamps.</li><li>A one-way hash of the teacher key. The readable key stays in the teacher’s browser unless they save it elsewhere.</li></ul><h2>Data the service does not collect</h2><p>Names are not required. The service does not collect GPS coordinates, biometrics, camera or microphone data, device fingerprints, advertising IDs, or analytics.</p><h2>Retention and deletion</h2><p>The teacher chooses 7, 30, 90, or 365 days. Expired classes are deleted. A teacher can also delete a class and its retained records immediately.</p><h2>Exports and licenses</h2><p>The server signs attendance exports. The browser encrypts the default download with AES-256-GCM and a passphrase. The passphrase and export file are not sent back to the service.</p><p>A saved license token is sent only to Sociobot’s billing API for verification. Verification runs at most once each day. Sociobot and Dodo act as merchant of record.</p><h2>Contact</h2><p>For privacy or deletion questions, email <a href="mailto:privacy@sociobot.in">privacy@sociobot.in</a>. Last updated 6 September 2026.</p>`;
  const terms = `<h1 class="page-title">Terms for classroom check-ins</h1><p class="lede">Use this service as an attendance aid, not as proof of identity or location.</p><h2>Appropriate use</h2><p>Teachers must choose non-identifying labels, issue tokens safely, protect recovery links, and follow school rules. Do not use this service for covert monitoring, policing, employment decisions, identity checks, or examination proctoring.</p><h2>No anti-cheating guarantee</h2><p>A learner can share a code or token. The service does not use biometrics, location, or device identity to prevent sharing. Review and correct each attendance record.</p><h2>Availability and records</h2><p>The service may be unavailable. Use the manual attendance control when a learner lacks a working device or connection. Review exports before treating them as official records.</p><h2>Printable cards purchase</h2><p>The optional printable cards license costs $29 once. Core check-in, correction, deletion, accessibility, and exports remain free. Checkout registration is pending. Sociobot and Dodo handle checkout and refunds after registration.</p><h2>Changes</h2><p>You remain responsible for school policy and privacy law. Material changes will be dated here. Last updated 6 September 2026.</p>`;
  const title = kind === 'privacy' ? 'Privacy — Privacy Class Check-in' : 'Terms — Privacy Class Check-in';
  setMeta(title, kind === 'privacy' ? 'Read what class data is stored, excluded, retained, and deleted.' : 'Read the terms for using private classroom attendance check-ins.', `/${kind}`);
  app.innerHTML = layout(`<div class="shell narrow legal"><p class="eyebrow">${kind === 'privacy' ? 'Privacy notice' : 'Use agreement'}</p>${kind === 'privacy' ? privacy : terms}<p><a href="/" data-route>Return to check-in</a></p></div>`);
  bindCommon();
}

function openExportPage() {
  setMeta('Open export — Privacy Class Check-in', 'Open an encrypted attendance export and verify its signature in your browser.', '/open-export');
  app.innerHTML = layout(`<div class="shell narrow"><p class="eyebrow">Local export tool</p><h1 class="page-title">Open and verify an attendance export</h1><p class="lede">Decrypt a <code>.pcc</code> file or verify a plain signed CSV. The file and passphrase stay in this browser.</p><form class="sheet" id="open-export-form"><div class="field"><label for="export-file">Attendance export</label><input class="input" id="export-file" type="file" accept=".pcc,.csv,application/json,text/csv" required></div><div class="field"><label for="open-pass">Passphrase <span class="plain-note">(encrypted files only)</span></label><input class="input" id="open-pass" type="password" autocomplete="current-password"></div><p id="open-export-error" class="error" role="alert"></p><button class="btn" type="submit">Open and verify</button></form><div id="verify-result" aria-live="polite"></div><p><a href="/" data-route>Return to check-in</a></p></div>`);
  bindCommon();
  document.querySelector<HTMLFormElement>('#open-export-form')!.addEventListener('submit', async (event) => { event.preventDefault(); const file = document.querySelector<HTMLInputElement>('#export-file')!.files?.[0]; const error = document.querySelector<HTMLElement>('#open-export-error')!; error.textContent = ''; if (!file) { error.textContent = 'Choose an export file.'; return; } try { const contents = await file.text(); const csv = file.name.endsWith('.pcc') ? await decryptExport(contents, document.querySelector<HTMLInputElement>('#open-pass')!.value) : contents; const valid = await verifySignedCsv(csv); const result = document.querySelector<HTMLElement>('#verify-result')!; result.innerHTML = `<div class="${valid ? 'success' : 'callout'}"><strong>${valid ? 'Signature verified.' : 'Signature could not be verified.'}</strong><br>${valid ? 'This file matches its included signing key.' : 'The file may be incomplete or changed. Review it carefully.'}</div><button class="btn secondary" type="button" id="save-opened">Download readable CSV</button>`; result.querySelector('#save-opened')?.addEventListener('click', () => download(new Blob([csv], { type: 'text/csv' }), file.name.replace(/\.attendance\.pcc$|\.pcc$/i, '.csv'))); } catch (caught) { error.textContent = (caught as Error).message; } });
}

async function renderRoute(moveFocus = false) {
  clearInterval(pollTimer);
  const path = location.pathname;
  if (path === '/privacy') legalPage('privacy');
  else if (path === '/terms') legalPage('terms');
  else if (path === '/open-export') openExportPage();
  else if (path === '/demo') await demoPage();
  else { const classId = new URLSearchParams(location.search).get('class'); if (classId) await teacherPage(classId); else landing(); if (location.hash) requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView()); }
  if (moveFocus) focusPage();
}

async function boot() {
  const serviceWorkerAllowed = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && serviceWorkerAllowed) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  license = initializeLicense();
  addEventListener('license-updated', (event) => { license = (event as CustomEvent<LicenseState>).detail; if (location.pathname === '/' && !new URLSearchParams(location.search).has('class')) landing(); });
  addEventListener('online', bindCommon); addEventListener('offline', bindCommon); addEventListener('popstate', () => void renderRoute(true));
  document.addEventListener('click', (event) => { const link = (event.target as Element).closest<HTMLAnchorElement>('a[data-route]'); if (!link || link.origin !== location.origin || event.defaultPrevented) return; event.preventDefault(); navigate(`${link.pathname}${link.search}${link.hash}`); });
  await renderRoute();
}

boot().catch((caught) => { app.innerHTML = layout(`<div class="shell narrow"><h1 class="page-title">The page could not load</h1><p class="error">${escapeHtml((caught as Error).message)}</p><button class="btn" id="reload" type="button">Reload page</button></div>`); document.querySelector('#reload')?.addEventListener('click', () => location.reload()); });
