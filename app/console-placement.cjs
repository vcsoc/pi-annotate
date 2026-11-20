'use strict';
const { consoleBounds } = require('./console-size.cjs');
const { dockBounds, undockBounds, same } = require('./console-snap.cjs');

// Wayland BrowserWindow.getBounds() may report (0, 0), not the compositor's
// actual position. Read owned compositor geometry before hiding or persisting.
function consolePlacement(win, { bounds, backend, areas, readBounds, float, save, report = () => {}, snap = false }) {
  let current = { ...bounds }, generation = 0, readVersion = 0, placing = false, disposed = false, timer, docked;
  const alive = () => !disposed && !win.isDestroyed();
  async function remember() {
    if (!alive() || placing || !win.isVisible() || win.isMinimized?.() || win.isFullScreen?.()) return current;
    const token = generation, version = ++readVersion;
    try {
      const actual = await readBounds();
      if (alive() && !placing && win.isVisible() && token === generation && version === readVersion && actual &&
          ['x', 'y', 'width', 'height'].every(k => Number.isFinite(actual[k])) && actual.width > 0 && actual.height > 0) {
        current = { ...actual }; save(current);
      }
    } catch (error) { report(error); }
    return current;
  }
  async function show() {
    if (!alive() || placing) return;
    if (win.isVisible()) { win.focus(); return; }
    const token = ++generation;
    placing = true;
    const isCurrent = () => alive() && token === generation;
    try {
      let available;
      try { available = await areas(); } catch (error) { report(error); }
      if (!isCurrent()) return;
      if (available) current = consoleBounds(current, available);
      if (backend) {
        // Equal min/max hints make this a floating surface at its FIRST map,
        // before IPC can see it. Unlock resizing only after floating placement.
        // Otherwise a resizable surface can briefly steal a browser's tile.
        win.setOpacity(0);
        win.setResizable(false);
        win.setMinimumSize(current.width, current.height);
        win.setMaximumSize(current.width, current.height);
      }
      win.setBounds(current);
      win.show();
      if (backend) await float({ ...current, isCurrent });
      if (!isCurrent() || !win.isVisible()) return;
      if (backend) {
        win.setMaximumSize(0, 0);
        win.setMinimumSize(Math.min(320, current.width), Math.min(360, current.height));
        win.setResizable(true);
        win.setOpacity(1);
      }
      win.focus();
    } catch (error) {
      if (isCurrent()) {
        // Keep a failed placement visible and fixed-size rather than exposing a
        // resizable tiled surface. A later hide/show retries the placement.
        if (backend) win.setOpacity(1);
        report(error);
      }
    } finally {
      if (isCurrent()) { placing = false; await remember(); }
    }
  }
  async function hide() {
    clearTimeout(timer);
    await remember();
    ++generation; placing = false;
    clearTimeout(timer);
    if (alive()) win.hide();
  }
  // After a drag settles, dock to a nearby left/right screen edge (6px gap),
  // or restore the pre-dock height when a docked Console is dragged away.
  async function settle() {
    if (!snap) return remember();
    if (!alive() || placing || !win.isVisible()) return current;
    const token = generation, isCurrent = () => alive() && !placing && token === generation && win.isVisible();
    try {
      const [actual, available] = await Promise.all([readBounds(), areas()]);
      if (!isCurrent() || !actual || !['x', 'y', 'width', 'height'].every(k => Number.isFinite(actual[k]))) return current;
      let target;
      const dock = dockBounds(actual, available);
      if (dock) {
        const { side, ...dockedBounds } = dock;
        if (!docked) docked = { side, restoreHeight: actual.height };
        docked = { ...docked, side, height: dockedBounds.height };
        target = dockedBounds;
      } else if (docked) {
        const previous = docked; docked = undefined;
        // A manual resize while docked is kept; only the automatic stretch is undone.
        if (Math.abs(actual.height - previous.height) <= 1) target = undockBounds(actual, available, previous.restoreHeight);
      }
      if (target && !same(target, actual)) {
        if (backend) await float({ ...target, isCurrent });
        else win.setBounds(target);
      }
    } catch (error) { report(error); }
    return remember();
  }
  function scheduleRemember() {
    if (!alive() || placing || !win.isVisible()) return;
    clearTimeout(timer); timer = setTimeout(() => { void settle(); }, snap ? 350 : 200);
  }
  function dispose() { disposed = true; ++generation; clearTimeout(timer); }
  win.on('move', scheduleRemember);
  win.on('resize', scheduleRemember);
  win.once('closed', dispose);
  return { show, hide, remember, settle, dispose, docked: () => docked?.side };
}
module.exports = { consolePlacement };
