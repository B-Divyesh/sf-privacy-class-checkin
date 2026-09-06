import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function createClass(request: APIRequestContext, label: string) {
  const response = await request.post('/api/classes', {
    data: { className: label, roster: ['Fern 01', 'Moss 02', 'Aster 03'], retentionDays: 7 },
    headers: { 'x-forwarded-for': `198.51.100.${Math.floor(Math.random() * 150) + 1}` },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ classId: string; teacherKey: string; roster: { id: string; alias: string; token: string }[] }>;
}

async function deleteClass(request: APIRequestContext, classId: string, teacherKey: string) {
  const response = await request.delete(`/api/classes/${classId}`, { headers: { 'x-teacher-key': teacherKey } });
  expect(response.ok()).toBeTruthy();
}

test('@claim:demo-sandbox sample data is populated, isolated, persistent, and resettable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pcc:real-sentinel', 'unchanged'));
  await page.goto('/');
  await page.getByRole('link', { name: 'Try it with sample data' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByText('Demo — sample data, nothing is saved')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(30);
  await expect(page.locator('.metric.present b')).toHaveText('22');
  const firstWorkspace = await page.locator('.demo-shell').getAttribute('data-workspace');
  await page.reload();
  await expect(page.locator('.demo-shell')).toHaveAttribute('data-workspace', firstWorkspace!);
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page.locator('.demo-shell')).not.toHaveAttribute('data-workspace', firstWorkspace!);
  expect(await page.evaluate(() => localStorage.getItem('pcc:real-sentinel'))).toBe('unchanged');
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('pcc:key:') || key.startsWith('pcc:tokens:')))).toEqual([]);
});

test('@claim:class-checkin a teacher session accepts one learner check-in', async ({ page, request }) => {
  const created = await createClass(request, `Claim check-in ${Date.now()}`);
  try {
    const start = await request.post(`/api/classes/${created.classId}/sessions`, { data: { lateAfterMinutes: 10, durationMinutes: 60 }, headers: { 'x-teacher-key': created.teacherKey } });
    expect(start.status()).toBe(201);
    const { sessionId } = await start.json() as { sessionId: string };
    const detail = await request.get(`/api/classes/${created.classId}/sessions/${sessionId}`, { headers: { 'x-teacher-key': created.teacherKey } });
    const session = await detail.json() as { code: string };
    await page.goto('/');
    await page.getByLabel('Current session code').fill(session.code);
    await page.getByLabel('Your roster token').fill(created.roster[0].token);
    await page.getByRole('button', { name: 'Record my check-in' }).click();
    await expect(page.getByText('Check-in recorded.')).toBeVisible();
    const updated = await request.get(`/api/classes/${created.classId}/sessions/${sessionId}`, { headers: { 'x-teacher-key': created.teacherKey } });
    const result = await updated.json() as { roster: { status: string }[] };
    expect(result.roster.filter((entry) => entry.status === 'present')).toHaveLength(1);
  } finally {
    await deleteClass(request, created.classId, created.teacherKey);
  }
});

test('@claim:data-minimization the demo sends requests only to this product', async ({ page }) => {
  const origins = new Set<string>();
  page.on('request', (request) => origins.add(new URL(request.url()).origin));
  const response = await page.goto('/demo');
  await expect(page.locator('tbody tr')).toHaveCount(30);
  await page.getByRole('button', { name: 'Record sample check-in' }).click();
  await expect(page.getByText('Sample check-in recorded.')).toBeVisible();
  expect([...origins]).toEqual(['http://127.0.0.1:8080']);
  expect(response?.headers()['permissions-policy']).toContain('camera=()');
  expect(response?.headers()['permissions-policy']).toContain('microphone=()');
  expect(response?.headers()['permissions-policy']).toContain('geolocation=()');
});

test('@claim:signed-export a sample export verifies after local encryption', async ({ page }) => {
  await page.goto('/demo');
  await expect(page.locator('tbody tr')).toHaveCount(30);
  await page.getByLabel('Export passphrase').fill('private sample passphrase');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download encrypted sample' }).click();
  const downloaded = await pending;
  const path = await downloaded.path();
  await page.goto('/open-export');
  await page.getByLabel('Attendance export').setInputFiles({ name: 'sample.attendance.pcc', mimeType: 'application/json', buffer: await readFile(path!) });
  await page.getByLabel(/Passphrase/).fill('private sample passphrase');
  await page.getByRole('button', { name: 'Open and verify' }).click();
  await expect(page.getByText('Signature verified.')).toBeVisible();
});

test('@claim:manual-correction a keyboard status change is labelled in the export', async ({ page, request }) => {
  await page.goto('/demo');
  const select = page.getByLabel('Status for Rush 30');
  await select.focus();
  await select.press('Home');
  await select.press('ArrowDown');
  await select.press('Enter');
  await expect(page.getByText('Sample status changed.')).toBeVisible();
  const workspace = await page.locator('.demo-shell').getAttribute('data-workspace');
  const exported = await request.get(`/api/demo/${workspace}/export`);
  expect(await exported.text()).toContain('"Rush 30",late,');
  expect(await (await request.get(`/api/demo/${workspace}/export`)).text()).toContain(',manual\r\n');
});

test('@claim:offline-shell warmed public pages reload without a network connection', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:8080' });
  try {
    const page = await context.newPage();
    await page.goto('/demo');
    await expect(page.locator('tbody tr')).toHaveCount(30);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    for (const path of ['/', '/demo', '/privacy', '/terms', '/open-export']) {
      await page.goto(path);
      await expect(page.locator('h1')).toHaveCount(1);
    }
    await context.setOffline(true);
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: 'How we handle class data' })).toBeVisible();
    await expect(page.getByText(/You’re offline/)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('@claim:cache-policy fingerprinted assets cache while pages and worker revalidate', async ({ page, request }) => {
  const documentResponse = await page.goto('/');
  const hero = await page.locator('.hero-plate img').getAttribute('src');
  expect(hero).toMatch(/^\/assets\/botanical-checkin-hero-[\w-]+\.webp$/);
  expect((await request.get(hero!)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(documentResponse?.headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/sw.js')).headers()['cache-control']).toBe('no-cache');
});

test('@claim:paid-license a recent valid license enables printing while the core stays free', async ({ page, request }) => {
  const created = await createClass(request, `License check ${Date.now()}`);
  const billingRequests: string[] = [];
  page.on('request', (outgoing) => { if (outgoing.url().includes('/products/privacy-class-checkin/verify')) billingRequests.push(outgoing.url()); });
  try {
    await page.addInitScript(({ classId, teacherKey, roster }) => {
      localStorage.setItem(`pcc:key:${classId}`, teacherKey);
      localStorage.setItem(`pcc:tokens:${classId}`, JSON.stringify(roster));
      localStorage.setItem('sb_license:privacy-class-checkin', 'test-valid-license-token');
      localStorage.setItem('sb_license:privacy-class-checkin:verdict', JSON.stringify({ valid: true, checkedAt: Date.now() }));
    }, { classId: created.classId, teacherKey: created.teacherKey, roster: created.roster });
    await page.goto(`/?class=${created.classId}&new=1`);
    await expect(page.getByRole('button', { name: 'Print token cards' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start rotating code' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download token list' })).toBeVisible();
    expect(billingRequests).toEqual([]);
  } finally {
    await deleteClass(request, created.classId, created.teacherKey);
  }
});
