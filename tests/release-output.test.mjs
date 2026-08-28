import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

test('production output versions the service-worker cache and precaches its hashed shell', async () => {
  const worker = await readFile('dist/sw.js', 'utf8');
  assert.match(worker, /const CACHE="pcc-shell-qa-regression";/);
  assert.doesNotMatch(worker, /pcc-shell-v1/);
  assert.match(worker, /"\/botanical-checkin-hero\.webp"/);

  const files = await readdir('dist/assets');
  for (const file of files.filter((file) => !file.endsWith('.map'))) {
    assert.match(worker, new RegExp(`/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  }
});
