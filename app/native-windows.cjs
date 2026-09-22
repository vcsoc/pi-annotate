const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const { readFile } = require('node:fs/promises');
const exec = promisify(execFile);
function normalizeWindows(rows, ownPid, convert = rect => rect) {
  return rows.filter(w => Number(w.pid) !== ownPid && w.visible !== false).map((w, index) => {
    const raw = { x: Number(w.x), y: Number(w.y), width: Number(w.width), height: Number(w.height) };
    const bounds = convert(raw);
    return { ...bounds, nativeId: String(w.id), label: String(w.title || 'Application').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160), focusOrder: Number.isFinite(w.order) ? w.order : index };
  }).filter(w => /^\d+$/.test(w.nativeId) && [w.x, w.y, w.width, w.height].every(Number.isFinite) && w.width > 1 && w.height > 1);
}
function sourceForWindow(sources, target) {
  const source = sources.find(s => s.id.startsWith('window:') && s.id.split(':')[1] === target.nativeId);
  if (!source) throw new Error('The marked application is not available for capture. Check Screen Recording permission, bring the app onscreen, then retry.');
  return source;
}
async function nativeWindows(platform, ownPid, screen, signal, run = exec) {
  const options = { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, signal };
  if (platform === 'darwin') {
    const result = await run('/usr/bin/osascript', ['-l', 'JavaScript', join(__dirname, 'native', 'windows-macos.js')], options);
    return normalizeWindows(JSON.parse(result.stdout), ownPid);
  }
  if (platform === 'win32') {
    const script = await readFile(join(__dirname, 'native', 'windows-win32.ps1'), 'utf8');
    const result = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options);
    return normalizeWindows(JSON.parse(result.stdout.replace(/^\uFEFF/, '')), ownPid, rect => screen.screenToDipRect(null, rect));
  }
  // Real X11 only; runtime.cjs refuses forced X11 inside a Wayland session.
  const [list, desktops, stack] = await Promise.all([run('wmctrl', ['-lpG'], options), run('wmctrl', ['-d'], options), run('xprop', ['-root', '_NET_CLIENT_LIST_STACKING'], options)]);
  const active = desktops.stdout.split('\n').find(line => /^\d+\s+\*/.test(line))?.split(/\s+/)[0];
  if (active === undefined) throw new Error('Cannot identify the active X11 workspace');
  const order = [...stack.stdout.matchAll(/0x[0-9a-f]+/gi)].map(m => BigInt(m[0]).toString()).reverse();
  const rows = list.stdout.split('\n').flatMap(line => {
    const m = line.match(/^(0x[\da-f]+)\s+(-?\d+)\s+(\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+\S+\s*(.*)$/i);
    if (!m || (m[2] !== active && m[2] !== '-1')) return [];
    const id = BigInt(m[1]).toString(), rank = order.indexOf(id);
    return [{ id, pid: Number(m[3]), x: Number(m[4]), y: Number(m[5]), width: Number(m[6]), height: Number(m[7]), title: m[8], order: rank < 0 ? 99999 : rank }];
  });
  return normalizeWindows(rows, ownPid);
}
module.exports = { normalizeWindows, sourceForWindow, nativeWindows };
