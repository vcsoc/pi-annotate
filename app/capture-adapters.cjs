const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const exec = promisify(execFile);
const placementExec = (command, args) => exec(command, args, { timeout: 1500, maxBuffer: 4 * 1024 * 1024 });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const TOOLBAR_WIDTH = 800, TOOLBAR_HEIGHT = 400;
const cleanLabel = value => String(value || '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 160);
function parseGeometry(value) {
  const match = String(value).trim().match(/^(-?\d+),(-?\d+) (\d+)x(\d+)$/);
  if (!match) throw new Error('The region picker returned invalid geometry');
  const [x, y, width, height] = match.slice(1).map(Number);
  if (![x, y, width, height].every(Number.isSafeInteger) || width < 2 || height < 2 || width > 32768 || height > 32768) throw new Error('Choose a region at least 2×2 pixels');
  return { x, y, width, height };
}
const geometry = box => `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`;
function visibleHyprWindows(clients, monitors, ownPid) {
  const workspaces = new Set(monitors.flatMap(m => [m.activeWorkspace?.id, m.specialWorkspace?.id]).filter(id => Number.isInteger(id) && id !== 0));
  return clients.filter(c => c.mapped && !c.hidden && c.pid !== ownPid && (c.pinned || workspaces.has(c.workspace?.id)) && c.size?.[0] > 1 && c.size?.[1] > 1)
    .map(c => ({ x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1], label: cleanLabel(c.title || c.class || 'Window'), address: c.address, floating: c.floating, focusOrder: c.focusHistoryID }));
}
function visibleSwayWindows(tree, ownPid, visibleWorkspaceIds) {
  const result = [];
  function visit(node, active = true) {
    const visible = active && (node.type !== 'workspace' || (visibleWorkspaceIds ? visibleWorkspaceIds.has(node.id) : node.visible === true));
    if (visible && node.pid && node.pid !== ownPid && (node.app_id || node.window_properties) && node.rect?.width > 1 && node.rect?.height > 1) result.push({ ...node.rect, label: cleanLabel(node.name || node.app_id || 'Window'), id: node.id, floating: /on$/.test(node.floating || ''), focusOrder: node.focused ? 0 : 1 });
    for (const child of [...(node.nodes || []), ...(node.floating_nodes || [])]) visit(child, visible);
  }
  visit(tree); return result;
}
async function windowBoxes(backend, ownPid) {
  if (backend === 'hyprland') {
    const [clients, monitors] = await Promise.all([exec('hyprctl', ['-j', 'clients']), exec('hyprctl', ['-j', 'monitors'])]);
    return visibleHyprWindows(JSON.parse(clients.stdout), JSON.parse(monitors.stdout), ownPid);
  }
  if (backend === 'sway') {
    const [tree, workspaces] = await Promise.all([exec('swaymsg', ['-t', 'get_tree', '-r']), exec('swaymsg', ['-t', 'get_workspaces', '-r'])]);
    return visibleSwayWindows(JSON.parse(tree.stdout), ownPid, new Set(JSON.parse(workspaces.stdout).filter(w => w.visible).map(w => w.id)));
  }
  return [];
}
function selectRegion(boxes, { signal, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    // With predefined boxes, click chooses a window; drag still selects any area.
    // No -o/-r: slurp spans every output, including negative-offset monitors.
    const child = spawn('slurp', ['-d', '-f', '%x,%y %wx%h', '-c', '#ff3b65', '-B', '#ff3b6520'], { stdio: ['pipe', 'pipe', 'pipe'], signal });
    let output = '', errors = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on('data', chunk => output += chunk);
    child.stderr.on('data', chunk => errors = (errors + chunk).slice(-1000));
    child.stdin.on('error', () => {});
    child.stdin.end(boxes.map(box => `${geometry(box)} ${cleanLabel(box.label)}`).join('\n') + (boxes.length ? '\n' : ''));
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) { const error = new Error(output.trim() ? errors || 'Selection failed' : 'Capture cancelled'); error.code = 'CAPTURE_CANCELLED'; reject(error); return; }
      try { resolve(parseGeometry(output)); } catch (error) { reject(error); }
    });
  });
}
function nativeChoices(sources) {
  return sources.filter(s => !/^(?:Pi Annotate\b|Annotate (?:Console|Note|Highlight|Capture|Sources)\b)/.test(s.name)).map(source => ({ id: source.id, name: cleanLabel(source.name), type: source.id.startsWith('window:') ? 'window' : 'screen', displayId: source.display_id, preview: source.thumbnail.toDataURL() }));
}
async function workAreas(backend) {
  if (backend === 'hyprland') {
    const monitors = JSON.parse((await placementExec('hyprctl', ['-j', 'monitors'])).stdout);
    return monitors.filter(m => !m.disabled).sort((a, b) => Number(Boolean(b.focused)) - Number(Boolean(a.focused))).map(m => {
      const [left = 0, top = 0, right = 0, bottom = 0] = m.reserved || [];
      const rotated = Number(m.transform) % 2 === 1;
      return { x: m.x + left, y: m.y + top, width: Math.round((rotated ? m.height : m.width) / m.scale) - left - right, height: Math.round((rotated ? m.width : m.height) / m.scale) - top - bottom };
    });
  }
  if (backend === 'sway') return JSON.parse((await placementExec('swaymsg', ['-t', 'get_outputs', '-r'])).stdout).filter(o => o.active).map(o => o.rect);
  return [];
}
async function ownedWindowBounds(win, backend, ownPid, run = placementExec) {
  if (win.isDestroyed() || !win.isVisible()) return;
  const title = win.getTitle();
  if (backend === 'hyprland') {
    const clients = JSON.parse((await run('hyprctl', ['-j', 'clients'])).stdout);
    const c = clients.find(c => c.pid === ownPid && c.title === title && c.mapped && !c.hidden && c.floating && !c.fullscreen);
    if (c?.at && c?.size) return { x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1] };
    return;
  }
  if (backend === 'sway') {
    const tree = JSON.parse((await run('swaymsg', ['-t', 'get_tree', '-r'])).stdout);
    let found;
    const visit = (node, floating = false) => {
      if (node.pid === ownPid && node.name === title && floating && !node.fullscreen_mode) found = node.rect;
      for (const child of node.nodes || []) visit(child, floating);
      for (const child of node.floating_nodes || []) visit(child, true);
    };
    visit(tree); return found;
  }
  return win.getBounds();
}
async function enforceFloating(win, backend, ownPid, { width = TOOLBAR_WIDTH, height = TOOLBAR_HEIGHT, x, y, isCurrent = () => true } = {}) {
  if (!backend) return;
  const exec = placementExec;
  const title = win.getTitle();
  for (let attempt = 0; attempt < 20 && !win.isDestroyed() && win.isVisible() && isCurrent(); attempt++) {
    if (backend === 'hyprland') {
      const clients = JSON.parse((await exec('hyprctl', ['-j', 'clients'])).stdout);
      if (!isCurrent() || win.isDestroyed() || !win.isVisible()) return;
      const client = clients.find(c => c.pid === ownPid && c.title === title && c.mapped);
      if (client && /^0x[a-f0-9]+$/i.test(client.address)) {
        const selector = `address:${client.address}`;
        // Current Lua dispatch API. Scoped to this exact app-owned window only.
        const position = Number.isFinite(x) && Number.isFinite(y) ? `hl.dispatch(hl.dsp.window.move({window=${JSON.stringify(selector)},x=${Math.round(x)},y=${Math.round(y)},relative=false}))` : `hl.dispatch(hl.dsp.window.center({window=${JSON.stringify(selector)}}))`;
        const result = await exec('hyprctl', ['eval', `hl.dispatch(hl.dsp.window.float({window=${JSON.stringify(selector)},action="enable"})); hl.dispatch(hl.dsp.window.resize({window=${JSON.stringify(selector)},x=${Math.round(width)},y=${Math.round(height)},relative=false})); ${position}`]).catch(() => null);
        if (!isCurrent() || win.isDestroyed() || !win.isVisible()) return;
        if (!result || /error|unknown|invalid/i.test(result.stdout)) {
          // Compatibility for pre-Lua Hyprland; never write global window rules.
          await exec('hyprctl', ['dispatch', 'setfloating', selector]);
          await exec('hyprctl', ['dispatch', 'resizewindowpixel', `exact ${Math.round(width)} ${Math.round(height)},${selector}`]);
          if (Number.isFinite(x) && Number.isFinite(y)) await exec('hyprctl', ['dispatch', 'movewindowpixel', `exact ${Math.round(x)} ${Math.round(y)},${selector}`]);
        }
        await delay(250);
        if (win.isDestroyed() || !win.isVisible() || !isCurrent()) return;
        const final = JSON.parse((await exec('hyprctl', ['-j', 'clients'])).stdout).find(c => c.address === client.address);
        // A stale placement must never unlock resizing on a newly mapped surface.
        if (!isCurrent() || win.isDestroyed() || !win.isVisible()) return;
        if (!final || final.pid !== ownPid || final.title !== title || !final.floating) throw new Error('Hyprland did not float the annotation window');
        return;
      }
    } else if (backend === 'sway') {
      const tree = JSON.parse((await exec('swaymsg', ['-t', 'get_tree', '-r'])).stdout);
      let found;
      const visit = node => { if (node.pid === ownPid && node.name === title) found = node; for (const child of [...(node.nodes || []), ...(node.floating_nodes || [])]) visit(child); };
      visit(tree);
      if (!isCurrent() || win.isDestroyed() || !win.isVisible()) return;
      if (found && Number.isSafeInteger(found.id)) {
        const result = JSON.parse((await exec('swaymsg', [`[con_id=${found.id}] floating enable, resize set ${Math.round(width)} px ${Math.round(height)} px, move ${Number.isFinite(x) && Number.isFinite(y) ? `absolute position ${Math.round(x)} px ${Math.round(y)} px` : 'position center'}`])).stdout);
        if (!Array.isArray(result) || !result.length || result.some(r => !r.success)) throw new Error('Sway did not position the annotation window');
        return;
      }
    }
    await delay(100);
  }
  if (!win.isDestroyed() && win.isVisible() && isCurrent()) throw new Error('Could not find the annotation window in the compositor');
}
module.exports = { TOOLBAR_WIDTH, TOOLBAR_HEIGHT, parseGeometry, geometry, visibleHyprWindows, visibleSwayWindows, windowBoxes, selectRegion, nativeChoices, workAreas, ownedWindowBounds, enforceFloating };
