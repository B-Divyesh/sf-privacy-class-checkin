import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test('identifies the release and applies cache policy to the offline shell', async ({ page, request }) => {
  const health = await request.get('/health');
  expect(health.headers()['cache-control']).toBe('no-store');
  await expect(health.json()).resolves.toEqual({ status: 'ok', buildSha: 'e2e-regression' });

  await page.goto('/');
  const moduleSrc = await page.locator('script[type="module"]').getAttribute('src');
  const asset = await request.get(moduleSrc!);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  const worker = await request.get('/sw.js');
  expect(worker.headers()['cache-control']).toBe('no-cache');
  expect(worker.ok()).toBeTruthy();
});

test('teacher creates a class and learner checks in', async ({ page, context, request }, testInfo) => {
  const errors:string[]=[]; page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto('/');
  await expect(page).toHaveTitle(/Privacy Class Check-in/);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.getByLabel('Class label').fill(`Field studies ${testInfo.project.name} ${Date.now()}`);
  await page.getByLabel('Pseudonyms, one per line').fill('Fern 01\nMoss 02\nAster 03');
  await page.getByRole('button',{name:'Create private class'}).click();
  await expect(page.getByText('Your class is ready.')).toBeVisible();
  const saved = await page.evaluate(() => { const id=new URL(location.href).searchParams.get('class')!; return { id, key:localStorage.getItem(`pcc:key:${id}`)!, tokens:JSON.parse(localStorage.getItem(`pcc:tokens:${id}`)!) }; });
  await page.getByRole('button',{name:'Start rotating code'}).click();
  const code=(await page.locator('.code').textContent())!.trim();
  const learner=await context.newPage();
  await learner.goto('/#check-in');
  await learner.getByLabel('Current session code').fill(code);
  await learner.getByLabel('Your roster token').fill(saved.tokens[0].token);
  await learner.getByRole('button',{name:'Record my check-in'}).click();
  await expect(learner.getByText('Check-in recorded.')).toBeVisible();
  await page.getByRole('button',{name:'Refresh records'}).click();
  await expect(page.locator('.metric.present b')).toHaveText('1');
  await page.getByLabel('Export passphrase').fill('botanical field key');
  const exportDownload=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download encrypted CSV'}).click();
  const exportFile=await exportDownload;
  const exportPath=await exportFile.path();
  await page.goto('/open-export');
  await page.getByLabel('Attendance export').setInputFiles({name:'attendance.pcc',mimeType:'application/json',buffer:await readFile(exportPath!)});
  await page.getByLabel(/Passphrase/).fill('botanical field key');
  await page.getByRole('button',{name:'Open and verify'}).click();
  await expect(page.getByText('Signature verified.')).toBeVisible();
  expect(errors).toEqual([]);
  expect((await request.delete(`/api/classes/${saved.id}`, { headers: { 'x-teacher-key': saved.key } })).ok()).toBeTruthy();
});

test('privacy and terms remain usable at mobile width', async ({ page }) => {
  for (const path of ['/privacy','/terms','/open-export']) { await page.goto(path); await expect(page.locator('main')).toBeVisible(); await expect(page.locator('h1')).toHaveCount(1); }
});

test('has no serious or critical automated accessibility violations', async ({ page }) => {
  for (const path of ['/', '/demo', '/privacy', '/terms', '/open-export', '/not-a-real-page']) {
    await page.goto(path);
    const result=await new AxeBuilder({page}).analyze();
    expect(result.violations.filter(item=>item.impact==='serious'||item.impact==='critical'), path).toEqual([]);
  }
});

test('known routes have metadata and an unknown route is a designed HTTP 404', async ({ page, request }) => {
  for (const [path, title] of [['/', /record attendance privately/], ['/demo', /^Demo —/], ['/privacy', /^Privacy —/], ['/terms', /^Terms —/], ['/open-export', /^Open export —/]] as const) {
    await page.goto(path);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('h1')).toHaveCount(1);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(path === '/' ? '/$' : `${path}$`));
  }
  expect((await request.get('/robots.txt')).headers()['content-type']).toContain('text/plain');
  expect(await (await request.get('/sitemap.xml')).text()).toContain('/demo');
  const missing = await request.get('/not-a-real-page');
  expect(missing.status()).toBe(404);
  await page.goto('/not-a-real-page');
  await expect(page).toHaveTitle('Page not found — Privacy Class Check-in');
  await expect(page.getByRole('heading', { name: 'This page was not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return home' })).toBeVisible();
});

test('the phone first screen states the job, audience, sample action, and three facts', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'phone-only first-screen check');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Record class attendance without tracking' })).toBeVisible();
  await expect(page.getByText(/For teachers running small classes/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Try it with sample data' })).toBeVisible();
  await expect(page.locator('.fact-list li')).toHaveCount(3);
  const home = await page.locator('.brand').boundingBox();
  expect(home!.width).toBeGreaterThanOrEqual(44);
  expect(home!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('client-side navigation updates history and focuses the page heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Privacy', exact: true }).first().click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { name: 'How we handle class data' })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Record class attendance without tracking' })).toBeFocused();
});

test('thirty learners can check in within two minutes without corrections', async ({ request }) => {
  const roster = Array.from({ length: 30 }, (_, index) => `Learner ${String(index + 1).padStart(2, '0')}`);
  const createdResponse = await request.post('/api/classes', { data: { className: `Thirty learner check ${Date.now()}`, roster, retentionDays: 7 }, headers: { 'x-forwarded-for': '198.51.100.230' } });
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json() as { classId: string; teacherKey: string; roster: { token: string }[] };
  try {
    const startedResponse = await request.post(`/api/classes/${created.classId}/sessions`, { data: { lateAfterMinutes: 10, durationMinutes: 60 }, headers: { 'x-teacher-key': created.teacherKey, 'x-forwarded-for': '198.51.100.230' } });
    const { sessionId } = await startedResponse.json() as { sessionId: string };
    const detailResponse = await request.get(`/api/classes/${created.classId}/sessions/${sessionId}`, { headers: { 'x-teacher-key': created.teacherKey } });
    const { code } = await detailResponse.json() as { code: string };
    const startedAt = Date.now();
    const responses = await Promise.all(created.roster.map((entry, index) => request.post('/api/checkins', { data: { code, token: entry.token }, headers: { 'x-forwarded-for': `203.0.113.${index + 1}` } })));
    expect(Date.now() - startedAt).toBeLessThan(120_000);
    expect(responses.every((response) => response.status() === 200)).toBeTruthy();
    const completeResponse = await request.get(`/api/classes/${created.classId}/sessions/${sessionId}`, { headers: { 'x-teacher-key': created.teacherKey } });
    const complete = await completeResponse.json() as { roster: { status: string; source: string | null }[] };
    expect(complete.roster.filter((entry) => entry.status === 'present')).toHaveLength(30);
    expect(complete.roster.filter((entry) => entry.source === 'manual')).toHaveLength(0);
  } finally {
    await request.delete(`/api/classes/${created.classId}`, { headers: { 'x-teacher-key': created.teacherKey } });
  }
});

test('API validation accepts documented boundaries and gives recovery errors', async ({ request }) => {
  const invalidCases = [
    { className: 'x', roster: ['Fern 01'], retentionDays: 7 },
    { className: 'Valid class', roster: [], retentionDays: 7 },
    { className: 'Valid class', roster: ['Fern 01', 'fern 01'], retentionDays: 7 },
    { className: 'Valid class', roster: ['Fern 01'], retentionDays: 366 },
    { className: 'Valid class', roster: Array.from({ length: 61 }, (_, index) => `Learner ${index}`), retentionDays: 7 },
  ];
  for (const [index, data] of invalidCases.entries()) {
    const response = await request.post('/api/classes', { data, headers: { 'x-forwarded-for': `192.0.2.${index + 1}` } });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  }
  const accepted = await request.post('/api/classes', { data: { className: 'x'.repeat(80), roster: Array.from({ length: 60 }, (_, index) => `Learner ${index + 1}`), retentionDays: 365 }, headers: { 'x-forwarded-for': '192.0.2.20' } });
  expect(accepted.status()).toBe(201);
  const created = await accepted.json() as { classId: string; teacherKey: string; roster: { token: string }[] };
  try {
    expect((await request.get(`/api/classes/${created.classId}`, { headers: { 'x-teacher-key': 'wrong-key' } })).status()).toBe(401);
    const invalidSession = await request.post(`/api/classes/${created.classId}/sessions`, { data: { lateAfterMinutes: 60, durationMinutes: 30 }, headers: { 'x-teacher-key': created.teacherKey, 'x-forwarded-for': '192.0.2.21' } });
    expect(invalidSession.status()).toBe(400);
    const started = await request.post(`/api/classes/${created.classId}/sessions`, { data: { lateAfterMinutes: 10, durationMinutes: 60 }, headers: { 'x-teacher-key': created.teacherKey, 'x-forwarded-for': '192.0.2.22' } });
    const { sessionId } = await started.json() as { sessionId: string };
    expect((await request.post(`/api/classes/${created.classId}/sessions`, { data: { lateAfterMinutes: 10, durationMinutes: 60 }, headers: { 'x-teacher-key': created.teacherKey, 'x-forwarded-for': '192.0.2.23' } })).status()).toBe(409);
    expect((await request.post('/api/checkins', { data: { code: '123', token: 'bad' }, headers: { 'x-forwarded-for': '192.0.2.24' } })).status()).toBe(400);
    const detail = await request.get(`/api/classes/${created.classId}/sessions/${sessionId}`, { headers: { 'x-teacher-key': created.teacherKey } });
    const { code } = await detail.json() as { code: string };
    expect((await request.post('/api/checkins', { data: { code, token: 'wrong-token' }, headers: { 'x-forwarded-for': '192.0.2.25' } })).status()).toBe(401);
  } finally {
    await request.delete(`/api/classes/${created.classId}`, { headers: { 'x-teacher-key': created.teacherKey } });
  }
});
