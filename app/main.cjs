const { app, BrowserWindow, desktopCapturer, screen, globalShortcut, ipcMain, session, nativeImage, dialog, systemPreferences } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { TOOLBAR_WIDTH, TOOLBAR_HEIGHT, geometry, windowBoxes, selectRegion, nativeChoices, workAreas, ownedWindowBounds, enforceFloating } = require('./capture-adapters.cjs');
const exec = promisify(execFile), workflow = import('./workflow.mjs');
const { loadBounds, saveBounds } = require('./console-size.cjs');
const { consolePlacement } = require('./console-placement.cjs');
const { registerShortcut: registerHyprlandShortcut } = require('./hyprland-shortcut.cjs');
const { nativeWindows, sourceForWindow } = require('./native-windows.cjs');
const { captureMacWindow } = require('./capture-macos.cjs');
const { selection: desktopMark, pointsInApp } = require('./desktop-selection.cjs');
const selectors = new Map();
let finishDesktop, cancelDesktop, desktopKind;
app.setName('Pi Annotate');
app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
const base = process.env.PI_ANNOTATE_URL, token = process.env.PI_ANNOTATE_TOKEN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base || '') || !/^[a-f0-9]{64}$/.test(token || '')) process.exit(1);
delete process.env.PI_ANNOTATE_TOKEN;
const { runtimeFor } = require('./runtime.cjs');
let runtime;
try { runtime = runtimeFor(process.platform, process.env); }
catch (error) { console.error(error.message); process.exit(1); }
const { wayland, backend, ozone } = runtime;
if (ozone) app.commandLine.appendSwitch('ozone-platform', ozone);
// GTK text-scaling-factor was leaking into Electron's Wayland surface DPR
// (0.90625 on the reported desktop), leaving an unpainted strip inside the WM
// bounds. Use compositor logical units for these positioned wlroots surfaces.
// This is local to the companion; desktop font/monitor settings are untouched.
if (backend || (process.platform === 'linux' && !wayland)) app.commandLine.appendSwitch('force-device-scale-factor', '1');
const windows = new Set(), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let consoleState, initialConsoleBounds, closingConsole = false, shortcutOwner;
let toolbar, overlay, noteWindow, markWindow, captureWindow, sourceWindow, info, frozen, sourceChoices = [], chooseSource, cancelSource, cancelPortal;
let drafts = [], selectedId, batchId = randomUUID(), sending = false, capturing = false, saving = false, quitting = false, shortcutReady = false, captureAbort;
const busy = () => quitting || closingConsole || sending || capturing || Boolean(frozen);
async function consoleAreas() {
  if (backend) return workAreas(backend);
  const preferred = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  return [preferred.workArea, ...screen.getAllDisplays().filter(d => d.id !== preferred.id).map(d => d.workArea)];
}
async function api(path, body) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `Pi bridge returned ${response.status}`); return value;
}
function changed() { if (toolbar && !toolbar.isDestroyed()) toolbar.webContents.send('state-changed'); }
function status(message) { if (toolbar && !toolbar.isDestroyed()) toolbar.webContents.send('notice', message); }
function windowFor(page, title, bounds = { width: TOOLBAR_WIDTH, height: TOOLBAR_HEIGHT }, passive = false) {
  const consoleWindow = page === 'toolbar';
  const inactiveSelector = process.platform === 'darwin' && page === 'desktop';
  if (consoleWindow) bounds = initialConsoleBounds;
  // On wlroots, map with fixed-size hints so the Console never joins the tiling
  // layout. The placement controller restores interactive resizing after float.
  const fixed = !consoleWindow || Boolean(backend);
  const win = new BrowserWindow({ ...bounds, ...(process.platform === 'linux' ? { type: 'dialog' } : inactiveSelector ? { type: 'panel', acceptFirstMouse: true } : {}), useContentSize: true, minWidth: fixed ? bounds.width : Math.min(320, bounds.width), minHeight: fixed ? bounds.height : Math.min(360, bounds.height), ...(fixed ? { maxWidth: bounds.width, maxHeight: bounds.height } : {}), frame: false, show: false, enableLargerThanScreen: page === 'desktop', resizable: !fixed, maximizable: false, fullscreenable: false, alwaysOnTop: true, transparent: Boolean(backend) || passive || page === 'desktop', backgroundColor: passive || page === 'desktop' ? '#00000000' : '#161b26', hasShadow: false, focusable: !passive && !inactiveSelector, skipTaskbar: passive || page === 'desktop', autoHideMenuBar: true, title, webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  windows.add(win);
  if (consoleWindow) {
    consoleState = consolePlacement(win, {
      bounds, backend, areas: consoleAreas,
      readBounds: () => ownedWindowBounds(win, backend, process.pid),
      float: placement => enforceFloating(win, backend, process.pid, placement),
      save: placement => saveBounds(join(app.getPath('userData'), 'console-size.json'), placement),
      report: error => { console.error('Console positioning:', error.message); status(`Console positioning: ${error.message}`); },
    });
  }
  win.on('closed', () => windows.delete(win));
  win.on('page-title-updated', event => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('focus', () => { if (!win.isDestroyed()) win.setAlwaysOnTop(true, 'floating'); });
  if (!consoleWindow) win.on('show', () => { if (page === 'desktop' && !backend) win.setBounds(bounds, false); void enforceFloating(win, backend, process.pid, bounds).catch(error => { if (!win.isDestroyed() && win.isVisible()) status(`Window positioning: ${error.message}`); }); });
  if (process.platform === 'darwin' && ['desktop', 'mark', 'note'].includes(page)) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (passive) win.setIgnoreMouseEvents(true);
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (consoleWindow) { if (!busy()) void consoleState.show(); }
    else if (passive || inactiveSelector) win.showInactive();
    else { win.show(); win.focus(); }
  });
  win.loadFile(join(__dirname, 'index.html'), { query: { page } });
  return win;
}
function authorize(event) { if (![...windows].some(win => !win.isDestroyed() && win.webContents === event.sender && event.senderFrame === win.webContents.mainFrame)) throw new Error('Untrusted window'); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => { authorize(event); return fn(event, ...args); }); }
function showToolbar() { if (!quitting && toolbar && !toolbar.isDestroyed()) { if (consoleState) void consoleState.show(); else { toolbar.show(); toolbar.focus(); } } }
function finishCapture(message) {
  frozen = undefined; saving = false;
  const closing = [overlay, noteWindow, markWindow]; overlay = noteWindow = markWindow = undefined;
  for (const win of closing) if (win && !win.isDestroyed()) win.destroy();
  changed(); showToolbar(); if (message) status(message);
}
function fit(image) {
  const size = image.getSize(); if (!size.width || !size.height) throw new Error('Capture is empty. Check screen recording permissions.');
  if (Math.max(size.width, size.height) > 1920) image = image.resize({ width: Math.round(size.width * 1920 / Math.max(size.width, size.height)), height: Math.round(size.height * 1920 / Math.max(size.width, size.height)) });
  while (image.toPNG().length > 2 * 1024 * 1024 && image.getSize().width > 640) image = image.resize({ width: Math.round(image.getSize().width * .8) });
  return image;
}
function openEditor() {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  overlay = windowFor('overlay', 'Annotate Capture', { width: Math.min(1200, area.width), height: Math.min(850, area.height) });
  const win = overlay; win.on('closed', () => { if (overlay === win) finishCapture('Capture cancelled. Existing annotations were kept.'); });
}
async function openLiveNote(region) {
  const { placeNote } = await workflow;
  const areas = backend ? await workAreas(backend) : screen.getAllDisplays().map(d => d.workArea);
  frozen.noteBounds = placeNote(region, areas);
  frozen.markBounds = region;
  markWindow = windowFor('mark', 'Annotate Highlight', region, true);
  noteWindow = windowFor('note', 'Annotate Note', frozen.noteBounds);
  const win = noteWindow; win.on('closed', () => { if (noteWindow === win) finishCapture('Capture cancelled. Existing annotations were kept.'); });
}
async function selectOnDesktop(kind) {
  const areas = backend ? await workAreas(backend) : screen.getAllDisplays().map(d => d.bounds);
  if (quitting || captureAbort?.signal.aborted) throw new Error('Capture cancelled');
  if (!areas.length) throw new Error('No displays are available');
  desktopKind = kind;
  return new Promise((resolve, reject) => {
    const abort = () => finish(new Error('Capture cancelled'));
    let escapeRegistered = false;
    const timer = setTimeout(() => finish(new Error('Capture selection timed out')), 120000);
    const finish = (error, result) => {
      if (finishDesktop !== finish) return;
      finishDesktop = cancelDesktop = undefined; clearTimeout(timer);
      if (escapeRegistered) globalShortcut.unregister('Escape');
      captureAbort?.signal.removeEventListener('abort', abort);
      const closing = [...selectors.keys()]; selectors.clear();
      for (const win of closing) if (!win.isDestroyed()) win.destroy();
      if (error) reject(error); else resolve(result);
    };
    finishDesktop = finish; cancelDesktop = abort;
    captureAbort.signal.addEventListener('abort', abort, { once: true });
    try {
      // Non-key macOS panels receive mouse input without activating Annotate.
      // They cannot receive keyboard Escape, so own it only during selection.
      if (process.platform === 'darwin') {
        escapeRegistered = globalShortcut.register('Escape', abort);
        if (!escapeRegistered) throw new Error('Cannot register Escape for non-activating capture. Release the conflicting shortcut and retry.');
      }
      for (const [i, bounds] of areas.entries()) {
        const win = windowFor('desktop', `Annotate Capture — display ${i + 1}`, bounds);
        selectors.set(win, bounds);
        win.once('closed', () => { if (selectors.has(win)) abort(); });
        win.webContents.once('render-process-gone', abort);
      }
    } catch (error) { finish(error); }
  });
}
function selectorFor(event) { return [...selectors.keys()].find(w => w.webContents === event.sender); }
handle('desktop-config', event => {
  const win = selectorFor(event); if (!win) throw new Error('No desktop selection');
  return { bounds: selectors.get(win), kind: desktopKind };
});
handle('desktop-mark', (event, points, complete) => {
  if (!selectorFor(event)) throw new Error('No desktop selection');
  if (typeof complete !== 'boolean') throw new Error('Invalid selection completion');
  const mark = desktopMark(desktopKind, points, [...selectors.values()]);
  if (complete) finishDesktop?.(null, mark);
  else for (const win of selectors.keys()) if (!win.isDestroyed()) win.webContents.send('desktop-progress', mark);
});
async function pickDesktopSource() {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 360, height: 220 }, fetchWindowIcons: false });
  sourceChoices = nativeChoices(sources).sort((a, b) => Number(a.type === 'screen') - Number(b.type === 'screen'));
  if (!sourceChoices.length) throw new Error('No apps are available. Check screen recording permissions.');
  return new Promise((resolve, reject) => {
    const finish = (error, id) => {
      chooseSource = cancelSource = undefined;
      const win = sourceWindow; sourceWindow = undefined;
      if (win && !win.isDestroyed()) win.destroy();
      if (error) reject(error); else resolve(id);
    };
    chooseSource = id => finish(null, id); cancelSource = () => finish(new Error('Capture cancelled'));
    sourceWindow = windowFor('sources', 'Annotate Sources');
    sourceWindow.once('closed', () => { if (sourceWindow) cancelSource?.(); });
  });
}
async function portalCapture() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Screen picker timed out. Try Capture again.')), 120000);
    const finish = (error, result) => {
      clearTimeout(timer); cancelPortal = undefined; ipcMain.removeHandler('portal-result');
      const win = captureWindow; captureWindow = undefined;
      if (win && !win.isDestroyed()) win.destroy();
      if (error) reject(error); else resolve(result);
    };
    cancelPortal = () => finish(new Error('Capture cancelled'));
    ipcMain.handle('portal-result', (event, result) => {
      authorize(event); if (event.sender !== captureWindow?.webContents) throw new Error('Unexpected capture sender');
      if (result.error) finish(new Error(result.error));
      else if (typeof result.image !== 'string' || result.image.length > 32 * 1024 * 1024) finish(new Error('Invalid screenshot'));
      else finish(null, { image: nativeImage.createFromDataURL(result.image), source: result.surface === 'window' ? 'System-selected application' : 'System-selected display', needsAppBounds: result.surface !== 'window' });
    });
    captureWindow = windowFor('portal', 'Annotate Capture — system picker');
    captureWindow.once('closed', () => { if (captureWindow) cancelPortal?.(); });
  });
}
async function capture(options = {}) {
  if (busy()) return;
  capturing = true; captureAbort = new AbortController(); changed();
  try {
    const { replaceId, copyId, kind = 'rectangle' } = options || {};
    if (!['rectangle', 'freehand'].includes(kind) || (replaceId && copyId)) throw new Error('Invalid capture request');
    const previous = (replaceId || copyId) && drafts.find(d => d.id === (replaceId || copyId));
    if ((replaceId || copyId) && !previous) throw new Error('Annotation no longer exists');
    if (!replaceId && drafts.length >= 12) throw new Error('Send or remove some annotations first (12 per batch).');
    if (consoleState) await consoleState.hide(); else toolbar.hide();
    if (quitting || captureAbort.signal.aborted) throw new Error('Capture cancelled');
    // macOS selector is non-activating; no screenshot or hide-settle wait
    // is needed before showing it. Other compositors retain their settle time.
    if (process.platform !== 'darwin') await delay(350);
    if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') === 'denied') throw new Error('Allow Pi Annotate/Electron in System Settings → Privacy & Security → Screen Recording, then restart /annotate.');
    let result, region, liveMarkPoints;
    if (backend && kind === 'rectangle') {
      const boxes = await windowBoxes(backend, process.pid);
      let selected;
      try { selected = await selectRegion(boxes, { signal: captureAbort.signal }); }
      catch (error) { if (error.code === 'ENOENT') throw new Error('Install slurp to mark directly on the desktop. No alternate screenshot editor was opened.'); throw error; }
      if (selected) {
        const { applicationForRegion, relativeMark, validateMark } = await workflow;
        // A mark identifies its containing APP. Never crop the evidence to the mark.
        const target = applicationForRegion(selected, await windowBoxes(backend, process.pid));
        const points = validateMark('rectangle', relativeMark(selected, target));
        await delay(150);
        const screenshot = await exec('grim', ['-g', geometry(target), '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000, signal: captureAbort.signal });
        result = { image: nativeImage.createFromBuffer(screenshot.stdout), source: `${target.label} · whole application`, needsAppBounds: false, points: kind === 'rectangle' ? points : undefined };
        if (kind === 'rectangle') region = selected;
      }
    } else {
      if (wayland && !backend) throw new Error('This Wayland compositor does not expose the window geometry/overlay placement needed for direct desktop marking. A compositor integration is required; Annotate will not silently switch to a different editor workflow.');
      // Resolve permission and window availability before covering the desktop.
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
        if (systemPreferences.getMediaAccessStatus('screen') !== 'granted') throw new Error('Grant Screen Recording to Pi Annotate/Electron, then restart the companion.');
      }
      const candidates = backend ? await windowBoxes(backend, process.pid) : await nativeWindows(process.platform, process.pid, screen, captureAbort.signal);
      if (!candidates.length) throw new Error('No application windows are available. Check capture permission and bring the app onscreen.');
      const marked = await selectOnDesktop(kind);
      const { applicationForRegion, validateMark } = await workflow;
      const target = applicationForRegion(marked.region, backend ? await windowBoxes(backend, process.pid) : candidates);
      region = marked.region;
      const points = validateMark(kind, pointsInApp(marked.points, target));
      liveMarkPoints = pointsInApp(marked.points, region);
      await delay(250); // Remove every selector before capturing the application.
      let image;
      if (backend) {
        const shot = await exec('grim', ['-g', geometry(target), '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 15000, signal: captureAbort.signal });
        image = nativeImage.createFromBuffer(shot.stdout);
      } else {
        const current = await nativeWindows(process.platform, process.pid, screen, captureAbort.signal);
        const same = current.find(w => w.nativeId === target.nativeId);
        if (!same || ['x', 'y', 'width', 'height'].some(key => Math.abs(same[key] - target[key]) > 1)) throw new Error('The marked application moved or closed during selection. Capture again.');
        if (process.platform === 'darwin') {
          image = nativeImage.createFromBuffer(await captureMacWindow(target.nativeId, captureAbort.signal));
        } else {
          const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1920, height: 1920 } });
          image = sourceForWindow(sources, target).thumbnail;
        }
      }
      result = { image, source: `${target.label} · whole application`, needsAppBounds: false, points };
    }
    if (!quitting) {
      const image = fit(result.image);
      frozen = { image: image.toDataURL(), size: image.getSize(), source: result.source.slice(0, 200), needsAppBounds: result.needsAppBounds, kind, points: result.points, liveMarkPoints, replaceId, comment: previous?.comment || '' };
      await openLiveNote(region);
    }
  } catch (error) { finishCapture(error.message); }
  finally { capturing = false; captureAbort = undefined; changed(); }
}
handle('portal-ready', async event => { if (event.sender !== captureWindow?.webContents) throw new Error('Unexpected capture sender'); captureWindow.hide(); await delay(500); });
handle('sources', event => { if (event.sender !== sourceWindow?.webContents) throw new Error('No source picker'); return sourceChoices; });
handle('choose-source', (event, id) => { if (event.sender !== sourceWindow?.webContents || !sourceChoices.some(s => s.id === id)) throw new Error('Invalid capture source'); chooseSource?.(id); });
handle('state', () => ({ project: info.project, shortcut: info.shortcut, shortcutReady, selectedId, sending, capturing: capturing || Boolean(frozen), backend: backend || (wayland ? 'portal' : 'native'), drafts: drafts.map(({ image, ...item }) => ({ ...item, preview: nativeImage.createFromDataURL('data:image/png;base64,' + image).resize({ width: 700 }).toDataURL() })) }));
handle('capture', (_event, options) => { void capture(options); });
handle('frozen', event => { if (![overlay?.webContents, noteWindow?.webContents, markWindow?.webContents].includes(event.sender)) throw new Error('No annotation in this window'); return frozen; });
handle('crop-app', async (event, points) => {
  if (event.sender !== overlay?.webContents || !frozen?.needsAppBounds) throw new Error('No application boundary to select');
  const { cropRectangle } = await import('./geometry.mjs');
  const image = nativeImage.createFromDataURL(frozen.image), rect = cropRectangle(points, image.getSize().width, image.getSize().height);
  const cropped = fit(image.crop(rect));
  frozen = { ...frozen, image: cropped.toDataURL(), source: `${frozen.source.replace(/ · whole application$/, '')} · manually bounded whole app`.slice(0, 200), size: cropped.getSize(), needsAppBounds: false, points: undefined };
  return frozen;
});
handle('mark', async (event, kind, points) => {
  if (event.sender !== overlay?.webContents || !frozen || frozen.needsAppBounds) throw new Error('Identify the whole application before marking an area');
  frozen.points = (await workflow).validateMark(kind, points); frozen.kind = kind;
  return frozen;
});
handle('cancel', event => {
  if (selectorFor(event)) return cancelDesktop?.();
  if (event.sender === sourceWindow?.webContents) return cancelSource?.();
  if (event.sender === captureWindow?.webContents) return cancelPortal?.();
  if ([overlay?.webContents, noteWindow?.webContents].includes(event.sender)) finishCapture('Capture cancelled. Existing annotations were kept.');
});
handle('add', async (event, item) => {
  if (![overlay?.webContents, noteWindow?.webContents].includes(event.sender) || !frozen || frozen.needsAppBounds || !frozen.points) throw new Error('Mark an area within the complete application first');
  if (sending || saving) throw new Error('Save or Send already in progress');
  const pending = frozen;
  saving = true;
  try {
    if (typeof item?.image !== 'string' || item.image.length > 4 * 1024 * 1024) throw new Error('Screenshot is too large');
    const [{ validateBatch, MAX_BODY }, { commitEntry }] = await Promise.all([import('../bridge.mjs'), workflow]);
    if (frozen !== pending || quitting) throw new Error('Capture changed before saving. Nothing was replaced.');
    const valid = validateBatch({ id: batchId, items: [{ image: item.image, comment: item.comment, kind: pending.kind, points: pending.points, source: pending.source }] }).items[0];
    if (valid.width !== pending.size.width || valid.height !== pending.size.height) throw new Error('The screenshot must include the complete app, not a cropped mark');
    const replacing = Boolean(pending.replaceId);
    const next = commitEntry(drafts, valid, pending.replaceId, randomUUID());
    if (Buffer.byteLength(JSON.stringify({ id: batchId, items: next })) > MAX_BODY - 1024) throw new Error('This batch is at its size limit. Send existing annotations before adding more.');
    selectedId = pending.replaceId || next.at(-1).id;
    drafts = next; batchId = randomUUID();
    // Let the renderer receive its save acknowledgment before destroying its IPC frame.
    setImmediate(() => { if (frozen === pending) finishCapture(`${replacing ? 'Replaced' : 'Saved'} annotation. The full app and highlighted area are together in one image. Nothing sent yet.`); });
    return { count: drafts.length };
  } catch (error) { if (frozen === pending) saving = false; throw error; }
});
function requireIdle() { if (busy()) throw new Error('Finish the current capture or send first'); }
handle('remove', (_event, id) => { requireIdle(); drafts = drafts.filter(d => d.id !== id); if (selectedId === id) selectedId = drafts[0]?.id; batchId = randomUUID(); changed(); });
handle('comment', (_event, id, comment) => { requireIdle(); if (typeof comment !== 'string' || comment.length > 8000) throw new Error('Invalid comment'); const item = drafts.find(d => d.id === id); if (item) { item.comment = comment; selectedId = id; batchId = randomUUID(); } });
handle('select', (_event, id) => { if (drafts.some(d => d.id === id)) selectedId = id; });
handle('clear', async () => {
  requireIdle();
  const result = await dialog.showMessageBox(toolbar, { type: 'question', message: 'Discard all unsent annotations?', buttons: ['Keep', 'Discard'], defaultId: 0, cancelId: 0 });
  if (result.response === 1 && !busy()) { drafts = []; selectedId = undefined; batchId = randomUUID(); changed(); }
});
handle('send', async () => {
  requireIdle(); if (!drafts.length) throw new Error('No annotations ready');
  sending = true; changed();
  try {
    if (consoleState) await consoleState.remember();
    const result = await api('/submit', { id: batchId, items: drafts });
    drafts = []; selectedId = undefined; batchId = randomUUID();
    // Keep controls locked and acknowledge Send before closing its IPC window.
    setImmediate(() => { quitting = true; app.quit(); });
    return result;
  } catch (error) { sending = false; changed(); throw error; }
});
handle('quit', () => toolbar.close());
app.whenReady().then(async () => {
  info = await api('/session');
  screen.on('display-removed', () => cancelDesktop?.());
  screen.on('display-metrics-changed', () => cancelDesktop?.());
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(wc === captureWindow?.webContents && permission === 'display-capture'));
  session.defaultSession.setPermissionCheckHandler((wc, permission) => wc === captureWindow?.webContents && permission === 'display-capture');
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    if (!captureWindow || request.frame !== captureWindow.webContents.mainFrame) { callback({}); return; }
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (sources.length !== 1) { callback({}); status('The desktop portal must select one app or screen. Check your portal backend.'); return; }
      callback({ video: sources[0] });
    } catch { callback({}); }
  }, { useSystemPicker: true });
  initialConsoleBounds = loadBounds(join(app.getPath('userData'), 'console-size.json'), await consoleAreas());
  toolbar = windowFor('toolbar', 'Annotate Console');
  toolbar.on('close', async event => {
    if (quitting) return;
    event.preventDefault();
    if (sending) { status('Sending annotations… The Console will close when delivery succeeds.'); return; }
    if (closingConsole) return;
    closingConsole = true;
    try {
      if (drafts.length || frozen || capturing) {
        const result = await dialog.showMessageBox(toolbar, { type: 'question', message: 'Close Annotate Console and discard unsent annotations?', buttons: ['Keep working', 'Discard and close'], defaultId: 0, cancelId: 0 });
        if (result.response !== 1) return;
      }
      await consoleState.remember();
      quitting = true; app.quit();
    } finally { closingConsole = false; }
  });
  let shortcutError;
  try {
    if (backend === 'hyprland') {
      shortcutOwner = await registerHyprlandShortcut(info.shortcut, () => void capture(), error => {
        shortcutReady = false; changed(); status(error.message);
      });
      if (quitting) { shortcutOwner.stop(); return; }
      shortcutReady = true;
    } else shortcutReady = globalShortcut.register(info.shortcut, () => void capture());
  } catch (error) { shortcutReady = false; shortcutError = error.message; }
  changed();
  if (shortcutError) status(shortcutError);
  await api('/status', { message: shortcutReady ? `Annotate Console ready. Mark an app area with ${info.shortcut}` : `Annotate Console ready. Use Capture; shortcut ${info.shortcut} is unavailable.${shortcutError ? ` ${shortcutError}` : ''}` });
  const watchdog = setInterval(() => api('/session').catch(() => { quitting = true; app.quit(); }), 5000); watchdog.unref();
}).catch(error => { dialog.showErrorBox('Annotate Console', error.message); app.exit(1); });
app.on('before-quit', () => { quitting = true; shortcutOwner?.stop(); consoleState?.dispose(); captureAbort?.abort(); cancelDesktop?.(); cancelSource?.(); cancelPortal?.(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
process.on('SIGTERM', async () => { quitting = true; if (consoleState) await consoleState.remember(); app.quit(); });
