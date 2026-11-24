import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SNAP_GAP, dockBounds, undockBounds } = require('../app/console-snap.cjs');
const { consolePlacement } = require('../app/console-placement.cjs');
const areas = [{ x: 0, y: 25, width: 1440, height: 875 }, { x: 1440, y: 0, width: 1920, height: 1080 }];

test('gap is within the requested 5–8px', () => { assert.ok(SNAP_GAP >= 5 && SNAP_GAP <= 8); });
test('released near the left or right edge docks full height with a gap on that screen', () => {
  assert.deepEqual(dockBounds({ x: 20, y: 300, width: 400, height: 600 }, areas), { side: 'left', x: 6, y: 31, width: 400, height: 863 });
  assert.deepEqual(dockBounds({ x: -50, y: 100, width: 400, height: 600 }, areas), { side: 'left', x: 6, y: 31, width: 400, height: 863 });
  assert.deepEqual(dockBounds({ x: 1020, y: 100, width: 400, height: 600 }, areas), { side: 'right', x: 1440 - 6 - 400, y: 31, width: 400, height: 863 });
  // Second monitor uses its own edges.
  assert.deepEqual(dockBounds({ x: 3360 - 320 - 10, y: 200, width: 320, height: 500 }, areas), { side: 'right', x: 3360 - 6 - 320, y: 6, width: 320, height: 1068 });
  assert.deepEqual(dockBounds({ x: 1450, y: 200, width: 320, height: 500 }, areas).side, 'left');
});
test('windows away from side edges are not docked', () => {
  assert.equal(dockBounds({ x: 200, y: 30, width: 400, height: 600 }, areas), undefined);
  assert.equal(dockBounds({ x: 200, y: 30, width: 400, height: 600 }, []), undefined);
});
test('undocking restores the height and keeps the panel on screen', () => {
  assert.deepEqual(undockBounds({ x: 500, y: 31, width: 400, height: 863 }, areas, 600), { x: 500, y: 31, width: 400, height: 600 });
  assert.deepEqual(undockBounds({ x: 500, y: 700, width: 400, height: 863 }, areas, 600), { x: 500, y: 300, width: 400, height: 600 });
});

function nativeConsole(t) {
  const win = new EventEmitter(); let bounds = { x: 500, y: 200, width: 400, height: 600 }; const set = [];
  Object.assign(win, { isDestroyed: () => false, isVisible: () => true, setBounds: b => { set.push({ ...b }); bounds = { ...b }; } });
  const saved = [];
  const state = consolePlacement(win, { bounds, backend: undefined, areas: async () => areas, readBounds: async () => bounds, float: async () => { throw new Error('No float on native'); }, save: b => saved.push(b), snap: true });
  t.after(() => state.dispose());
  return { state, set, saved, drag: b => { bounds = { ...bounds, ...b }; } };
}
test('native Console docks after a drag, re-docks idempotently, and restores height when dragged away', async t => {
  const c = nativeConsole(t);
  await c.state.settle(); assert.equal(c.set.length, 0);
  c.drag({ x: 1030 }); await c.state.settle();
  assert.deepEqual(c.set.at(-1), { x: 1034, y: 31, width: 400, height: 863 }); assert.equal(c.state.docked(), 'right');
  assert.deepEqual(c.saved.at(-1), c.set.at(-1));
  await c.state.settle(); assert.equal(c.set.length, 1);
  c.drag({ x: 600, y: 40 }); await c.state.settle();
  assert.deepEqual(c.set.at(-1), { x: 600, y: 40, width: 400, height: 600 }); assert.equal(c.state.docked(), undefined);
});
test('a Console resized by hand while docked keeps its height when undocked', async t => {
  const c = nativeConsole(t);
  c.drag({ x: 10 }); await c.state.settle(); assert.equal(c.state.docked(), 'left');
  c.drag({ height: 500 }); c.drag({ x: 600 }); const count = c.set.length; await c.state.settle();
  assert.equal(c.set.length, count);
});
test('snap is opt-in: placement without it never moves the window', async t => {
  const win = new EventEmitter(); const set = [];
  Object.assign(win, { isDestroyed: () => false, isVisible: () => true, setBounds: b => set.push(b) });
  const state = consolePlacement(win, { bounds: { x: 5, y: 30, width: 400, height: 600 }, areas: async () => areas, readBounds: async () => ({ x: 5, y: 30, width: 400, height: 600 }), save() {} });
  t.after(() => state.dispose());
  await state.settle(); assert.deepEqual(set, []);
});
test('docking keeps a user-resized height and only snaps to the edge', () => {
  assert.deepEqual(dockBounds({ x: 1060, y: 120, width: 360, height: 700 }, areas, { keepHeight: true }), { side: 'right', x: 1440 - 6 - 360, y: 120, width: 360, height: 700 });
  // Too tall for the screen: clamped inside the work area with the gap.
  assert.deepEqual(dockBounds({ x: 10, y: 0, width: 320, height: 2000 }, areas, { keepHeight: true }), { side: 'left', x: 6, y: 31, width: 320, height: 863 });
});
test('resizing a docked Console persists the new size instead of snapping back', async t => {
  const win = new EventEmitter(); let bounds = { x: 1114, y: 200, width: 320, height: 525 }; const set = [], saved = [];
  Object.assign(win, { isDestroyed: () => false, isVisible: () => true, setBounds: b => { set.push({ ...b }); bounds = { ...b }; } });
  const state = consolePlacement(win, { bounds, areas: async () => areas, readBounds: async () => bounds, save: b => saved.push({ ...b }), snap: true, dock: { keepHeight: true } });
  t.after(() => state.dispose());
  await state.settle(); assert.equal(state.docked(), 'right');
  // User drags the bottom edge and the left edge: taller and wider.
  bounds = { x: 1014, y: 200, width: 420, height: 640 }; await state.settle();
  assert.deepEqual(saved.at(-1), { x: 1014, y: 200, width: 420, height: 640 });
  assert.equal(set.length, 0);
});
