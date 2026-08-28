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
  await expect(worker.text()).resolves.toMatch(/const CACHE="pcc-shell-e2e-regression";/);
});

test('teacher creates a class and learner checks in', async ({ page, context }, testInfo) => {
  const errors:string[]=[]; page.on('console',message=>{if(message.type()==='error')errors.push(message.text())});
  await page.goto('/');
  await expect(page).toHaveTitle(/Privacy Class Check-in/);
  await expect(page.locator('h1')).toHaveCount(1);
  await page.getByLabel('Class label').fill(`Field studies ${testInfo.project.name} ${Date.now()}`);
  await page.getByLabel('Pseudonyms, one per line').fill('Fern 01\nMoss 02\nAster 03');
  await page.getByRole('button',{name:'Create private class'}).click();
  await expect(page.getByText('Your class is ready.')).toBeVisible();
  const saved = await page.evaluate(() => { const id=new URL(location.href).searchParams.get('class')!; return { id, tokens:JSON.parse(localStorage.getItem(`pcc:tokens:${id}`)!) }; });
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
});

test('privacy and terms remain usable at mobile width', async ({ page }) => {
  for (const path of ['/privacy','/terms','/open-export']) { await page.goto(path); await expect(page.locator('main')).toBeVisible(); await expect(page.locator('h1')).toHaveCount(1); }
});

test('has no serious or critical automated accessibility violations', async ({ page }) => {
  await page.goto('/');
  const result=await new AxeBuilder({page}).analyze();
  expect(result.violations.filter(item=>item.impact==='serious'||item.impact==='critical')).toEqual([]);
});
