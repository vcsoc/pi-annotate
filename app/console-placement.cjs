'use strict';
const { consoleBounds } = require('./console-size.cjs');

// Wayland BrowserWindow.getBounds() may report (0, 0), not the compositor's
// actual position. Read owned compositor geometry before hiding or persisting.
function consolePlacement(win, { bounds, backend, areas, readBounds, float, save, report = () => {} }) {
  let current = { ...bounds }, generation = 0, readVersion = 0, placing = false, disposed = false, timer;
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
  function scheduleRemember() {
    if (!alive() || placing || !win.isVisible()) return;
    clearTimeout(timer); timer = setTimeout(() => { void remember(); }, 200);
  }
  function dispose() { disposed = true; ++generation; clearTimeout(timer); }
  win.on('move', scheduleRemember);
  win.on('resize', scheduleRemember);
  win.once('closed', dispose);
  return { show, hide, remember, dispose };
}
module.exports = { consolePlacement };
