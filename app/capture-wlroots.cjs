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
  if (![0, 3000].includes(ms)) throw new Error('Invalid capture delay');
  if (ms) await wait(ms, undefined, { signal });
  signal?.throwIfAborted();
}
async function snapshotDesktop(backend, { decode, signal, run = exec }) {
  if (!['hyprland', 'sway'].includes(backend)) throw new Error('Unsupported preserved capture backend');
  signal?.throwIfAborted();
  const options = { timeout: 15000, maxBuffer: 64 * 1024 * 1024, signal };
  const response = backend === 'hyprland'
    ? await run('hyprctl', ['-j', 'monitors'], { ...options, maxBuffer: 1024 * 1024 })
    : await run('swaymsg', ['-t', 'get_outputs', '-r'], { ...options, maxBuffer: 1024 * 1024 });
  const areas = displayBounds(backend, JSON.parse(response.stdout)), bounds = desktopBounds(areas);
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
    const thumbnail = crop(box), scale = Math.min(1, 1920 / Math.max(box.width, box.height));
    return (scale < 1 ? thumbnail.resize({ width: Math.round(box.width * scale), height: Math.round(box.height * scale) }) : thumbnail).toDataURL();
  } };
}
module.exports = { displayBounds, desktopBounds, waitForCapture, snapshotDesktop };
