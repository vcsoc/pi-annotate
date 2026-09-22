import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { request } from 'node:http';
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn, execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { accelerator, matching, installShortcut, removeBinding } = require('../app/hyprland-shortcut.cjs');
const linux = { skip: process.platform !== 'linux' };
function compositor() {
  const state = { binds: [], commands: [] };
  state.run = async (command, args) => {
    state.commands.push([command, args]);
    if (command === 'curl') return { stdout: 'curl test fixture' };
    assert.equal(command, 'hyprctl');
    if (args[0] === '-j') return { stdout: JSON.stringify(state.binds) };
    assert.equal(args[0], 'eval');
    if (args[1].startsWith('hl.unbind(')) state.binds = [];
    else {
      assert.match(args[1], /non_consuming=false,auto_consuming=false,dont_inhibit=true,submap_universal=true/);
      assert.doesNotMatch(args[1], /locked=true|kill|PI_ANNOTATE_TOKEN/);
      const description = JSON.parse(args[1].match(/description=("[^"]*")/)[1]);
      state.binds.push({ modmask: 5, key: 'A', description, non_consuming: false, auto_consuming: false });
    }
    return { stdout: 'ok' };
  };
  return state;
}
function trigger(lease, valid = true, method = 'POST') {
  const config = readFileSync(join(lease.descriptor.directory, 'trigger.conf'), 'utf8');
  const socket = config.match(/abstract-unix-socket = "([^"]+)"/)[1];
  const secret = config.match(/X-Pi-Annotate-Shortcut: ([a-f0-9]+)/)[1];
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: '\0' + socket, path: '/capture', method, headers: { 'X-Pi-Annotate-Shortcut': valid ? secret : 'wrong' } }, res => { res.resume(); res.once('end', () => resolve(res.statusCode)); });
    req.once('error', reject); req.end();
  });
}
test('accelerators normalize supported modifiers and reject command injection/plain typing keys', () => {
  assert.deepEqual(accelerator('CommandOrControl+Shift+A'), { chord: 'CTRL + SHIFT + A', key: 'A', mask: 5 });
  assert.deepEqual(accelerator('Super+Alt+F12'), { chord: 'ALT + SUPER + F12', key: 'F12', mask: 72 });
  for (const value of ['A', 'Ctrl+A;exec bad', 'Ctrl+"', 'Other+A', 'Ctrl+']) assert.throws(() => accelerator(value));
  assert.equal(matching([{ key: 'a', modmask: 5 }, { key: 'B', modmask: 5 }, { keycode: 38, modmask: 5 }], accelerator('Ctrl+Shift+A')).length, 2);
});
test('consuming binding captures authenticated requests and releases the chord on stop', linux, async t => {
  const wm = compositor(); let count = 0;
  const lease = await installShortcut('Ctrl+Shift+A', () => count++, wm.run);
  t.after(() => lease.stop());
  assert.equal(wm.binds.length, 1);
  assert.equal(await trigger(lease, false), 403);
  assert.equal(await trigger(lease, true, 'GET'), 403);
  assert.equal(count, 0);
  assert.equal(await trigger(lease), 204); assert.equal(count, 1);
  await lease.stop();
  assert.equal(wm.binds.length, 0);
  assert.equal(existsSync(lease.descriptor.directory), false);
  await lease.stop();
});
test('real curl config triggers the isolated abstract socket without any desktop process', { skip: process.platform !== 'linux' || spawnSync('curl', ['--version']).status !== 0 }, async t => {
  const wm = compositor(); let count = 0;
  const lease = await installShortcut('Ctrl+Shift+A', () => count++, wm.run);
  t.after(() => lease.stop());
  await promisify(execFile)('curl', ['-q', '--config', join(lease.descriptor.directory, 'trigger.conf')], { timeout: 3000 });
  assert.equal(count, 1);
});
test('another Console cannot race registration or remove the first Console binding', linux, async t => {
  const wm = compositor(), lease = await installShortcut('Ctrl+Shift+A', () => {}, wm.run);
  t.after(() => lease.stop());
  await assert.rejects(installShortcut('Ctrl+Shift+A', () => {}, wm.run), /Another Annotate Console owns/);
  assert.equal(wm.binds[0].description, lease.descriptor.description);
});
test('existing desktop shortcut is preserved, not silently stolen', linux, async () => {
  const wm = compositor(); wm.binds.push({ key: 'A', modmask: 5, description: 'User shortcut' });
  await assert.rejects(installShortcut('Ctrl+Shift+A', () => {}, wm.run), /already has a desktop binding/);
  assert.equal(wm.binds[0].description, 'User shortcut');
  assert.equal(wm.commands.some(([, args]) => args[0] === 'eval'), false);
});
test('cleanup does not unbind user configuration that replaced or joined the temporary binding', async () => {
  const wm = compositor();
  const descriptor = { ...accelerator('Ctrl+Shift+A'), description: 'Owned' };
  wm.binds.push({ key: 'A', modmask: 5, description: 'User replacement' });
  await removeBinding(descriptor, wm.run);
  assert.equal(wm.binds.length, 1);
  wm.binds.push({ key: 'A', modmask: 5, description: 'Owned' });
  await removeBinding(descriptor, wm.run);
  assert.equal(wm.binds.length, 2);
});
test('failed verification rolls back the owned binding', linux, async () => {
  const wm = compositor();
  const run = async (command, args) => {
    const result = await wm.run(command, args);
    if (args[0] === 'eval' && args[1].startsWith('hl.bind(')) wm.binds[0].non_consuming = true;
    return result;
  };
  await assert.rejects(installShortcut('Ctrl+Shift+A', () => {}, run), /exclusive Annotate/);
  assert.equal(wm.binds.length, 0);
});
test('compositor reload restores a free chord but a new user binding disables ownership', { ...linux, timeout: 3000 }, async t => {
  const wm = compositor(); let failure;
  const failed = new Promise(resolve => { failure = resolve; });
  const lease = await installShortcut('Ctrl+Shift+A', () => {}, wm.run, failure, 20);
  t.after(() => lease.stop());
  wm.binds = [];
  for (let i = 0; i < 100 && !wm.binds.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(wm.binds[0]?.description, lease.descriptor.description);
  wm.binds = [{ key: 'A', modmask: 5, description: 'New user binding' }];
  assert.match((await failed).message, /exclusive Annotate/);
  await lease.stop();
  assert.equal(wm.binds[0].description, 'New user binding');
});
test('stale Annotate binding is recovered only after obtaining exclusive ownership', linux, async t => {
  const wm = compositor();
  wm.binds = [{ key: 'A', modmask: 5, description: 'Pi Annotate capture ' + 'a'.repeat(32) }];
  const lease = await installShortcut('Ctrl+Shift+A', () => {}, wm.run);
  t.after(() => lease.stop());
  assert.equal(wm.binds.length, 1);
  assert.equal(wm.binds[0].description, lease.descriptor.description);
});
test('helper releases its lease on owner IPC disconnect without launching Electron or touching desktop binds', { timeout: 5000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'annotate-worker-test-')), marker = join(root, 'released');
  const module = fileURLToPath(new URL('../app/hyprland-shortcut.cjs', import.meta.url));
  const code = `require(${JSON.stringify(module)}).runWorker(async () => ({ descriptor: {}, stop: async () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'released') }));`;
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    const exit = once(child, 'exit');
    const [message] = await once(child, 'message'); assert.equal(message.type, 'ready');
    child.disconnect();
    const [status] = await exit; assert.equal(status, 0);
    assert.equal(readFileSync(marker, 'utf8'), 'released');
  } finally { child.kill(); rmSync(root, { recursive: true, force: true }); }
});
