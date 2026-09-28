import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as module from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as targets from '../targets.mjs';
import * as bridge from '../bridge.mjs';
import * as delivery from '../delivery.mjs';
const require = module.createRequire(import.meta.url);
const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
const filename = fileURLToPath(new URL('../index.ts', import.meta.url));
function batch(id = randomUUID()) {
  const image = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(image);
  image.write('IHDR', 12); image.writeUInt32BE(100, 16); image.writeUInt32BE(80, 20);
  return { id, items: [{ image: image.toString('base64'), comment: 'Change this control', kind: 'rectangle', points: [[0, 0], [.5, .5]], source: 'Test app' }] };
}
async function fixture(t, { staleFactory = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'annotate-routing-'));
  const directory = join(root, 'registry'), instances = [], spawned = [];
  t.after(async () => { for (const instance of instances) await instance.events.get('session_shutdown')(); rmSync(root, { recursive: true, force: true }); });
  async function session(name) {
    const events = new Map(), commands = new Map(), messages = [], notices = [];
    const ctx = { cwd: join(root, name), hasUI: true, model: { input: ['text', 'image'] }, sessionManager: { getSessionId: () => name + '-session' }, ui: { notify: message => notices.push(message), setStatus() {} } };
    const pi = { on: (name, fn) => events.set(name, fn), registerCommand: (name, command) => commands.set(name, command), getSessionName: () => name, sendUserMessage: (content, options) => messages.push({ content, options }) };
    const js = module.stripTypeScriptTypes(source)
      .replace(/import \{([^}]+)\} from '([^']+)';/g, 'const {$1} = require("$2");')
      .replace('import.meta.url', JSON.stringify(new URL('../index.ts', import.meta.url).href))
      .replace('export default function annotate', 'module.exports = function annotate');
    const sandbox = {
      module: { exports: {} }, console, process,
      require: name => {
        if (name === 'node:child_process') return { spawn() {
          const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), exitCode: null, killed: false });
          child.kill = () => { child.killed = true; child.exitCode = 0; child.emit('close', 0, null); };
          spawned.push(child); return child;
        } };
        if (name === './dependencies.mjs') return { ensureDependencies: async () => '/not-launched/electron' };
        // Simulate a legacy module still cached by a long-lived Pi process.
        const legacy = { ...bridge, createBridge: options => bridge.createBridge({ ...options, getInfo: undefined }) };
        if (name === './bridge.mjs') return legacy;
        if (name === './session-bridge.mjs') return staleFactory ? legacy : bridge;
        if (name === './delivery.mjs') return delivery;
        if (name === './targets.mjs') return { ...targets, advertise: record => targets.advertise(record, directory), activeTargets: () => targets.activeTargets(directory), createRouting: (self, options) => targets.createRouting(self, { ...options, directory }) };
        return require(name);
      },
    };
    vm.runInNewContext(js, sandbox, { filename }); sandbox.module.exports(pi);
    const instance = { events, commands, messages, ctx, pi, notices, run: (args = '') => commands.get('annotate').handler(args, ctx) };
    instances.push(instance); await events.get('session_start')({}, ctx);
    instance.record = targets.records(directory).find(record => record.project === ctx.cwd);
    if (!staleFactory) assert.ok(instance.record); return instance;
  }
  return { root, directory, session, spawned };
}
const compiler = { skip: typeof module.stripTypeScriptTypes !== 'function' };
test('running /annotate in another Pi reuses the Console and delivers only to that session and folder', compiler, async t => {
  const f = await fixture(t), a = await f.session('A'), b = await f.session('B');
  assert.equal((await targets.activeTargets(f.directory)).length, 2);
  await a.run(); assert.equal(f.spawned.length, 1);
  await b.run(); assert.equal(f.spawned.length, 1); assert.equal(f.spawned[0].killed, false);
  const payload = batch();
  const response = await targets.request(a.record, '/submit', { ...payload, targetId: b.record.id }, 5000);
  assert.equal(a.messages.length, 0); assert.equal(b.messages.length, 1);
  assert.equal(response.destination.project, b.ctx.cwd);
  assert.equal(existsSync(join(a.ctx.cwd, '.pi', 'annotations', payload.id)), false);
  const metadata = JSON.parse(readFileSync(join(b.ctx.cwd, '.pi', 'annotations', payload.id, 'annotations.json'), 'utf8'));
  assert.equal(metadata.project, b.ctx.cwd); assert.equal(metadata.session, 'B-session');
  assert.equal(b.messages[0].options.deliverAs, 'followUp');
  // An acknowledged retry does not inject another message.
  await targets.request(a.record, '/submit', { ...payload, targetId: b.record.id });
  assert.equal(b.messages.length, 1);
  await b.run('stop'); assert.equal(f.spawned[0].killed, true);
});
test('dropdown changes preserve session identity; stale Send cannot go to a newly selected project', compiler, async t => {
  const f = await fixture(t), a = await f.session('A'), b = await f.session('B'); await a.run();
  await targets.request(a.record, '/target', { id: b.record.id });
  await assert.rejects(targets.request(a.record, '/submit', { ...batch(), targetId: a.record.id }), /Destination changed/);
  assert.equal(a.messages.length + b.messages.length, 0);
  await targets.request(a.record, '/target', { id: a.record.id });
  await targets.request(a.record, '/submit', { ...batch(), targetId: a.record.id });
  assert.equal(a.messages.length, 1); assert.equal(b.messages.length, 0);
});
test('closed destination stays selected and cannot silently fall back to the Console owner', compiler, async t => {
  const f = await fixture(t), a = await f.session('A'), b = await f.session('B'); await a.run(); await b.run();
  await b.events.get('session_shutdown')();
  await assert.rejects(targets.request(a.record, '/submit', { ...batch(), targetId: b.record.id }), /offline/);
  assert.equal(a.messages.length, 0); assert.equal(f.spawned[0].killed, false);
  const response = await fetch(a.record.url + '/targets', { headers: { Authorization: `Bearer ${a.record.token}` } });
  const options = await response.json(); assert.equal(options.selected.id, b.record.id); assert.equal(options.available, false);
  assert.equal(JSON.stringify(options).includes(a.record.token), false);
});
test('destination changes are rejected throughout in-flight delivery', compiler, async t => {
  const f = await fixture(t), a = await f.session('A'), b = await f.session('B'); await a.run(); await b.run();
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  b.pi.sendUserMessage = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
  const sending = targets.request(a.record, '/submit', { ...batch(), targetId: b.record.id }, 5000);
  await started;
  await assert.rejects(targets.request(a.record, '/target', { id: a.record.id }), /in progress/);
  finish(); await sending;
});
test('failed/uncertain batch cannot be retried into a different session', compiler, async t => {
  const f = await fixture(t), a = await f.session('A'), b = await f.session('B'); await a.run(); await b.run();
  b.pi.sendUserMessage = () => { throw new Error('Temporary failure'); };
  const payload = batch();
  await assert.rejects(targets.request(a.record, '/submit', { ...payload, targetId: b.record.id }), /Temporary failure/);
  await a.run();
  await assert.rejects(targets.request(a.record, '/submit', { ...payload, targetId: a.record.id }), /already attempted/);
  assert.equal(a.messages.length, 0);
});
test('outdated factory is caught before advertising a broken session destination', compiler, async t => {
  const f = await fixture(t, { staleFactory: true }), a = await f.session('A');
  assert.equal(targets.records(f.directory).length, 0);
  assert.ok(a.notices.some(message => /outdated bridge module.*restart Pi/.test(message)));
});
test('destination directory does not accept arbitrary URLs or path traversal', async () => {
  assert.throws(() => targets.advertise({ id: '../../oops' }), /Invalid/);
  await assert.rejects(targets.request({ url: 'https://example.com' }, '/session'), /Invalid/);
});
