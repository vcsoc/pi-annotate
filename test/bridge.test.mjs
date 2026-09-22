import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createBridge, validateBatch, MAX_BODY } from '../bridge.mjs';
import { normalizedPoint, selectionBounds, validSelection } from '../app/geometry.mjs';

const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=';
const item = () => ({ image, comment: 'Move this button', kind: 'rectangle', points: [[0.1, 0.2], [0.6, 0.8]], source: 'Display 1' });
const batch = id => ({ id: id || 'test-batch-123', items: [item()] });
async function fixture(t, onSubmit = async () => ({ count: 1 })) {
  const bridge = await createBridge({ onSubmit, project: '/project', session: 'test-session', shortcut: 'Ctrl+Shift+A' });
  t.after(() => bridge.close());
  const request = (body, extra = {}) => fetch(bridge.url + '/submit', { method: 'POST', headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  return { bridge, request };
}
test('batch validation accepts screenshots, comments and normalized selection metadata', () => {
  const result = validateBatch(batch());
  assert.equal(result.items[0].width, 1);
  assert.equal(result.items[0].comment, 'Move this button');
  for (const edit of [i => i.comment = '', i => i.image = 'not-png', i => i.points = [[NaN, 0], [1, 1]], i => i.points = [[0, 0], [2, 1]], i => i.kind = 'script', i => i.comment = 'x'.repeat(8001)]) {
    const value = batch(); edit(value.items[0]); assert.throws(() => validateBatch(value));
  }
  assert.throws(() => validateBatch({ ...batch(), id: '../../escape' }));
  assert.throws(() => validateBatch({ ...batch(), items: Array(13).fill(item()) }));
});
test('only native companion credentials work; browser origins are rejected', async t => {
  const { bridge, request } = await fixture(t);
  assert.equal((await fetch(bridge.url + '/session')).status, 401);
  assert.equal((await request(batch(), { Origin: 'http://evil.test' })).status, 401);
  assert.equal((await request(batch(), { Authorization: 'Bearer wrong' })).status, 401);
  const wrongHost = await new Promise(resolve => {
    const req = http.get(bridge.url + '/session', { headers: { Host: 'evil.test', Authorization: `Bearer ${bridge.token}` } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', error => assert.fail(error.message));
  });
  assert.equal(wrongHost, 401);
  const response = await fetch(bridge.url + '/session', { headers: { Authorization: `Bearer ${bridge.token}` } });
  assert.equal((await response.json()).project, '/project');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});
test('explicit Send delivers once, acknowledges retries and permits later batches', async t => {
  let delivered = 0;
  const { request } = await fixture(t, async b => { delivered++; return { count: b.items.length, savedTo: '/test' }; });
  assert.equal(delivered, 0);
  assert.equal((await request(batch())).status, 200);
  assert.equal((await request(batch())).status, 200);
  assert.equal(delivered, 1);
  assert.equal((await request(batch('test-batch-456'))).status, 200);
  assert.equal(delivered, 2);
});
test('failed delivery retains retryability instead of acknowledging lost work', async t => {
  let attempts = 0;
  const { request } = await fixture(t, async () => { if (++attempts === 1) throw new Error('Select a vision model'); return {}; });
  const failed = await request(batch()); assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /vision/);
  assert.equal((await request(batch())).status, 200);
});
test('simultaneous sends are serialized', async t => {
  let release, entered;
  const ready = new Promise(r => entered = r);
  const { request } = await fixture(t, async () => { entered(); await new Promise(r => release = r); return {}; });
  const first = request(batch()); await ready;
  assert.equal((await request(batch('test-batch-456'))).status, 409);
  release(); assert.equal((await first).status, 200);
});
test('invalid JSON, excessive payloads and arbitrary endpoints do not deliver', async t => {
  const { bridge, request } = await fixture(t, async () => assert.fail('must not submit'));
  assert.equal((await request({ ...batch(), items: [] })).status, 400);
  assert.equal((await request({ junk: 'x'.repeat(MAX_BODY) })).status, 413);
  const headers = { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' };
  assert.equal((await fetch(bridge.url + '/submit', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(bridge.url + '/other', { headers })).status, 404);
});
test('geometry maps HiDPI display coordinates independently of screenshot resolution', () => {
  assert.deepEqual(normalizedPoint(250, 150, { left: 50, top: 50, width: 400, height: 200 }), [0.5, 0.5]);
  assert.deepEqual(normalizedPoint(-2, 500, { left: 0, top: 0, width: 400, height: 200 }), [0, 1]);
  assert.deepEqual(selectionBounds([[0.9, 0.8], [0.1, 0.2]]), { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 });
  assert.equal(validSelection([[0, 0], [0.001, 0.001]]), false);
  assert.equal(validSelection([[0.9, 0.8], [0.1, 0.2]]), true);
});
