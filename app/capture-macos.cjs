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
// Screen rectangle (global points) for a mark extended past its app window.
async function captureMacRegion(rect, signal, run = exec) {
  if (!['x', 'y', 'width', 'height'].every(k => Number.isFinite(rect?.[k])) || rect.width < 1 || rect.height < 1) throw new Error('Invalid capture area');
  if (signal?.aborted) throw new Error('Capture cancelled');
  const directory = await mkdtemp(join(tmpdir(), 'pi-annotate-region-'));
  try {
    const file = join(directory, 'region.png');
    await run('/usr/sbin/screencapture', ['-x', '-R', [rect.x, rect.y, rect.width, rect.height].map(Math.round).join(','), '-t', 'png', file], { timeout: 15000, signal, maxBuffer: 1024 * 1024 });
    if (signal?.aborted) throw new Error('Capture cancelled');
    return await readFile(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
module.exports = { captureMacWindow, captureMacRegion };
