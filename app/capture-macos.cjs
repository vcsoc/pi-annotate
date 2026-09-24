const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const exec = promisify(execFile);

// Capture only the selected native window, without activating it or adding
// its shadow. Temporary evidence is removed on success, error and cancellation.
async function captureMacWindow(nativeId, signal, run = exec) {
  if (!/^\d+$/.test(String(nativeId)) || Number(nativeId) <= 0) throw new Error('Invalid macOS window id');
  if (signal?.aborted) throw new Error('Capture cancelled');
  const directory = await mkdtemp(join(tmpdir(), 'pi-annotate-window-'));
  try {
    const file = join(directory, 'window.png');
    await run('/usr/sbin/screencapture', ['-x', '-o', '-l', String(nativeId), '-t', 'png', file], { timeout: 15000, signal, maxBuffer: 1024 * 1024 });
    if (signal?.aborted) throw new Error('Capture cancelled');
    return await readFile(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
module.exports = { captureMacWindow };
