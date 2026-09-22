import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverBatch } from '../delivery.mjs';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5v8AAAAASUVORK5CYII=';
const batch = () => ({ id: 'batch-test-123', items: [
  { image, comment: 'Make this bigger', kind: 'rectangle', points: [[0, 0], [1, 1]], source: 'Display 1' },
  { image, comment: 'Fix this color', kind: 'freehand', points: [[0, 0], [1, 0], [0.5, 1]], source: 'Display 2' },
] });
test('delivery sends one multimodal user message with every comment and highlighted PNG', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-annotate-test-')); t.after(() => rm(cwd, { recursive: true, force: true }));
  let message, options, calls = 0;
  const result = await deliverBatch(batch(), { cwd, session: 'session-123', send: (content, mode) => { calls++; message = content; options = mode; } });
  assert.equal(calls, 1); assert.equal(result.count, 2);
  assert.deepEqual(options, { deliverAs: 'followUp' });
  assert.deepEqual(message.filter(x => x.type === 'image'), [{ type: 'image', data: image, mimeType: 'image/png' }, { type: 'image', data: image, mimeType: 'image/png' }]);
  assert.match(message[1].text, /Make this bigger/); assert.match(message[3].text, /Fix this color/);
  assert.ok((await readFile(join(result.savedTo, '1.png'))).equals(Buffer.from(image, 'base64')));
  const metadata = JSON.parse(await readFile(join(result.savedTo, 'annotations.json')));
  assert.equal(metadata.session, 'session-123'); assert.equal(metadata.items[1].file, '2.png');
  assert.equal(metadata.items[0].image, undefined);
  if (process.platform !== 'win32') assert.equal((await stat(join(result.savedTo, '1.png'))).mode & 0o777, 0o600);
});
test('session replacement blocks delivery even if files were already saved', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-annotate-test-')); t.after(() => rm(cwd, { recursive: true, force: true }));
  let checks = 0;
  await assert.rejects(deliverBatch(batch(), { cwd, session: 'old-session', assertActive() { if (++checks > 1) throw new Error('Session changed'); }, send: () => assert.fail('must not send') }), /Session changed/);
});
test('invalid batch IDs cannot escape the project annotations directory', async t => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-annotate-test-')); t.after(() => rm(cwd, { recursive: true, force: true }));
  await assert.rejects(deliverBatch({ ...batch(), id: '../../escape' }, { cwd, session: 'test', send() {} }), /Invalid batch ID/);
});
