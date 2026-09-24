import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { writeFile, access } from 'node:fs/promises';
import { dirname } from 'node:path';
const { captureMacWindow } = createRequire(import.meta.url)('../app/capture-macos.cjs');
test('captures one native window without interactive selection or shadows and cleans up', async () => {
  let output;
  const image = await captureMacWindow('1234', undefined, async (command, args, options) => {
    assert.equal(command, '/usr/sbin/screencapture');
    assert.deepEqual(args.slice(0, -1), ['-x', '-o', '-l', '1234', '-t', 'png']);
    assert.equal(options.timeout, 15000);
    output = args.at(-1); await writeFile(output, 'image bytes');
  });
  assert.equal(image.toString(), 'image bytes');
  await assert.rejects(access(dirname(output)), /ENOENT/);
});
test('failed capture cleans up without silently capturing all windows', async () => {
  let output;
  await assert.rejects(captureMacWindow('123', undefined, async (_command, args) => {
    output = args.at(-1); throw new Error('Permission denied');
  }), /Permission denied/);
  await assert.rejects(access(dirname(output)), /ENOENT/);
});
test('rejects invalid ids and cancellation before running a process', async () => {
  const deny = async () => { assert.fail('must not execute'); };
  for (const id of ['0', '-1', '1;bad', '']) await assert.rejects(captureMacWindow(id, undefined, deny), /Invalid/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(captureMacWindow('123', controller.signal, deny), /cancelled/);
});
