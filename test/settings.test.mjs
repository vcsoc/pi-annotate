import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { loadSettings, saveSettings, validateSettings } = createRequire(import.meta.url)('../app/settings.cjs');
test('countdown defaults to one second and persists validated changes', t => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-settings-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  assert.equal(loadSettings(file).countdownSeconds, 1);
  saveSettings(file, { countdownSeconds: 0 }); assert.equal(loadSettings(file).countdownSeconds, 0);
  saveSettings(file, { countdownSeconds: 7 }); assert.equal(loadSettings(file).countdownSeconds, 7);
  for (const countdownSeconds of [-1, 31, 1.5, '2', null]) assert.throws(() => validateSettings({ countdownSeconds }), /whole number/);
  assert.equal(loadSettings(file).countdownSeconds, 7);
});
test('settings toggle, credit and explicit GitHub link are present', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="toggle-settings"[^>]*aria-expanded="false"/);
  assert.match(html, /Developed by Chris Visser/);
  assert.match(html, /href="https:\/\/github.com\/vcsoc"/);
  assert.match(html, /value="live">Live marking \(default\)/);
  assert.match(html, /value="preserved">Preserved frame/);
});
test('combined defaults, strict validation, private atomic persistence and legacy preference migration', t => {
  const dir = mkdtempSync(join(tmpdir(), 'annotate-settings-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings.json');
  assert.deepEqual(loadSettings(file), { countdownSeconds: 1, captureMode: 'live', maxAnnotations: 8, defaultDeliverAs: 'followUp' });
  writeFileSync(file, JSON.stringify({ countdownSeconds: 7 }));
  writeFileSync(join(dir, 'annotation-settings.json'), JSON.stringify({ maxAnnotations: 4, defaultDeliverAs: 'steer' }));
  assert.deepEqual(loadSettings(file), { countdownSeconds: 7, captureMode: 'live', maxAnnotations: 4, defaultDeliverAs: 'steer' });
  const next = { countdownSeconds: 0, captureMode: 'preserved', maxAnnotations: 12, defaultDeliverAs: 'followUp' };
  saveSettings(file, next); assert.deepEqual(loadSettings(file), next);
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readdirSync(dir).some(name => name.endsWith('.tmp')), false);
  for (const change of [{ captureMode: 'frozen' }, { maxAnnotations: 0 }, { maxAnnotations: 13 }, { maxAnnotations: 1.5 }, { maxAnnotations: '8' }, { defaultDeliverAs: 'abort' }]) {
    assert.throws(() => saveSettings(file, { ...next, ...change })); assert.deepEqual(loadSettings(file), next);
  }
  writeFileSync(file, 'corrupt'); assert.equal(loadSettings(file).captureMode, 'live');
});
