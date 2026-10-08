const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { setTimeout: wait } = require('node:timers/promises');
const exec = promisify(execFile);

function displayBounds(backend, outputs) {
  const areas = backend === 'hyprland'
    ? outputs.filter(m => !m.disabled).map(m => ({ x: m.x, y: m.y, width: Math.round((m.transform % 2 ? m.height : m.width) / m.scale), height: Math.round((m.transform % 2 ? m.width : m.height) / m.scale) }))
    : outputs.filter(m => m.active).map(m => m.rect);
  if (!areas.length || areas.length > 16 || areas.some(a => ![a.x, a.y, a.width, a.height].every(Number.isSafeInteger) || a.width < 2 || a.height < 2)) throw new Error('Cannot determine valid display bounds');
  return areas;
}
function desktopBounds(areas) {
  const x = Math.min(...areas.map(a => a.x)), y = Math.min(...areas.map(a => a.y));
  const width = Math.max(...areas.map(a => a.x + a.width)) - x;
  const height = Math.max(...areas.map(a => a.y + a.height)) - y;
  if (width > 32768 || height > 32768 || width * height > 32 * 1024 * 1024) throw new Error('Desktop span is too large to preserve safely');
  return { x, y, width, height };
}
async function waitForCapture(ms, signal) {
  if (!Number.isInteger(ms) || ms < 0 || ms > 30000) throw new Error('Invalid capture delay');
  if (ms) await wait(ms, undefined, { signal });
  signal?.throwIfAborted();
}
const layoutKey = areas => JSON.stringify(areas.map(({ x, y, width, height }) => [x, y, width, height]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
async function readDisplayBounds(backend, { signal, run = exec } = {}) {
  const options = { timeout: 1500, maxBuffer: 1024 * 1024, signal };
  const response = backend === 'hyprland'
    ? await run('hyprctl', ['-j', 'monitors'], options)
    : await run('swaymsg', ['-t', 'get_outputs', '-r'], options);
  return displayBounds(backend, JSON.parse(response.stdout));
}
async function snapshotDesktop(backend, { decode, signal, run = exec }) {
  if (!['hyprland', 'sway'].includes(backend)) throw new Error('Unsupported preserved capture backend');
  signal?.throwIfAborted();
  const options = { timeout: 15000, maxBuffer: 64 * 1024 * 1024, signal };
  const areas = await readDisplayBounds(backend, { signal, run }), bounds = desktopBounds(areas);
  // Fixed scale gives one pixel per compositor logical coordinate on mixed-DPI
  // displays, independent of grim's default highest-output-scale behavior.
  const shot = await run('grim', ['-s', '1', '-g', `${bounds.x},${bounds.y} ${bounds.width}x${bounds.height}`, '-'], { ...options, encoding: 'buffer' });
  signal?.throwIfAborted();
  const image = decode(shot.stdout), size = image.getSize();
  if (size.width !== bounds.width || size.height !== bounds.height) throw new Error('Desktop geometry changed during capture. Capture again.');
  const crop = box => {
    const rect = { x: box.x - bounds.x, y: box.y - bounds.y, width: box.width, height: box.height };
    if (!Object.values(rect).every(Number.isSafeInteger) || rect.x < 0 || rect.y < 0 || rect.width < 2 || rect.height < 2 || rect.x + rect.width > size.width || rect.y + rect.height > size.height) throw new Error('The entire application must be onscreen to preserve it. Move it onscreen and capture again.');
    return image.crop(rect);
  };
  return { areas, crop, preview(box) {
    // Keep the desktop backdrop at its captured logical resolution. Downscaling
    // a 4K monitor to 1920px and stretching it back makes text visibly blurred.
    return crop(box).toDataURL();
  } };
}
module.exports = { displayBounds, desktopBounds, waitForCapture, snapshotDesktop, readDisplayBounds, layoutKey };
