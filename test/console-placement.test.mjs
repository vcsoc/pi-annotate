import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { consoleBounds, loadBounds, saveBounds, saveSize } = require('../app/console-size.cjs');
const { consolePlacement } = require('../app/console-placement.cjs');
const { ownedWindowBounds } = require('../app/capture-adapters.cjs');
const areas = [{ x: 0, y: 0, width: 1920, height: 1080 }, { x: -1920, y: 0, width: 1920, height: 1080 }];
const original = { x: -1600, y: 180, width: 400, height: 600 };
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, options = {}) {
  const calls = [], saved = [], errors = [];
  const win = new EventEmitter();
  let visible = false, actual = { ...original }, resizable = true, minimum, maximum;
  Object.assign(win, {
    isDestroyed: () => false, isVisible: () => visible, getTitle: () => 'Annotate Console',
    // Simulate Electron's unreliable Wayland origin. Only compositor geometry
    // is allowed to replace a successfully saved desktop position.
    getBounds: () => ({ x: 0, y: 0, width: 400, height: 600 }),
    setOpacity: value => calls.push(['opacity', value]),
    setResizable: value => { resizable = value; calls.push(['resizable', value]); },
    setMinimumSize: (...value) => { minimum = value; },
    setMaximumSize: (...value) => { maximum = value; },
    setBounds: value => calls.push(['bounds', { ...value }]),
    show: () => { calls.push(['map', { resizable, minimum, maximum }]); visible = true; },
    hide: () => { calls.push(['hide']); visible = false; }, focus: () => calls.push(['focus']),
  });
  const state = consolePlacement(win, {
    bounds: original, backend: 'hyprland', areas: async () => areas,
    readBounds: async () => actual,
    float: async bounds => { calls.push(['float', bounds]); actual = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }; },
    save: bounds => saved.push({ ...bounds }), report: error => errors.push(error), ...options,
  });
  t.after(() => state.dispose());
  return { state, win, calls, saved, errors, moved: bounds => { actual = bounds; } };
}
test('position and size survive process restarts; old size-only preferences migrate', () => {
  const root = mkdtempSync(join(tmpdir(), 'annotate-bounds-')), file = join(root, 'console-size.json');
  try {
    saveBounds(file, original); assert.deepEqual(loadBounds(file, areas), original);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);
    saveSize(file, { width: 550, height: 750 });
    assert.deepEqual(loadBounds(file, areas), { width: 550, height: 750, x: 685, y: 165 });
    for (const bad of ['not json', 'null', '{}']) {
      writeFileSync(file, bad); assert.deepEqual(loadBounds(file, areas), { width: 400, height: 600, x: 760, y: 240 });
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('disconnected displays recover safely; valid negative and spanning positions do not recenter', () => {
  assert.deepEqual(consoleBounds(original, areas), original);
  assert.deepEqual(consoleBounds(original, [areas[0]]), { width: 400, height: 600, x: 760, y: 240 });
  assert.deepEqual(consoleBounds({ ...original, x: 10, y: 10 }, [{ x: 0, y: 0, width: 800, height: 400 }]), { width: 400, height: 400, x: 200, y: 0 });
  const spanning = { ...original, x: -100 };
  assert.deepEqual(consoleBounds(spanning, areas), spanning);
  assert.deepEqual(consoleBounds({ width: 2000, height: 1000, x: 99999, y: 99999 }, [{ x: 0, y: 0, width: 800, height: 700 }]), { width: 800, height: 700, x: 0, y: 0 });
});
test('Console has fixed floating hints BEFORE mapping; resize unlock follows explicit placement', async t => {
  const f = fixture(t); await f.state.show();
  assert.deepEqual(f.calls.find(c => c[0] === 'map')[1], { resizable: false, minimum: [400, 600], maximum: [400, 600] });
  const floated = f.calls.findIndex(c => c[0] === 'float');
  assert.ok(floated > f.calls.findIndex(c => c[0] === 'map'));
  assert.ok(f.calls.findIndex(c => c[0] === 'resizable' && c[1]) > floated);
  assert.equal(f.calls.find(c => c[0] === 'float')[1].x, -1600);
  assert.deepEqual(f.saved.at(-1), original);
});
test('capture return restores latest compositor position AND user-resized dimensions, not startup bounds', async t => {
  const f = fixture(t); await f.state.show();
  const moved = { x: 1300, y: 90, width: 550, height: 750 };
  f.moved(moved); await f.state.hide();
  assert.deepEqual(f.saved.at(-1), moved);
  await f.state.show();
  assert.deepEqual(f.calls.filter(c => c[0] === 'bounds').at(-1)[1], moved);
  assert.deepEqual(f.calls.filter(c => c[0] === 'map').at(-1)[1].minimum, [550, 750]);
  assert.deepEqual(f.saved.at(-1), moved);
});
test('showing an already-visible Console only focuses it, without resetting user placement', async t => {
  const f = fixture(t); await f.state.show(); const count = f.calls.length;
  await f.state.show(); assert.deepEqual(f.calls.slice(count), [['focus']]);
});
test('missing Wayland geometry never overwrites saved position with Electron zero coordinates', async t => {
  const f = fixture(t, { readBounds: async () => undefined });
  await f.state.show(); await f.state.hide(); await f.state.show();
  assert.equal(f.saved.length, 0);
  assert.deepEqual(f.calls.filter(c => c[0] === 'bounds').at(-1)[1], original);
});
test('cancelled asynchronous placement cannot reveal or resize a hidden Console', async t => {
  let release, placement;
  const f = fixture(t, { float: bounds => { placement = bounds; return new Promise(resolve => { release = resolve; }); } });
  const showing = f.state.show(); await tick(); await f.state.hide();
  assert.equal(placement.isCurrent(), false);
  const count = f.calls.length; release(); await showing;
  assert.deepEqual(f.calls.slice(count), []); assert.equal(f.saved.length, 0);
});
test('failed floating keeps fixed-size protection and reports the error', async t => {
  const f = fixture(t, { float: async () => { throw new Error('Compositor unavailable'); }, readBounds: async () => undefined });
  await f.state.show();
  assert.equal(f.errors[0].message, 'Compositor unavailable');
  assert.equal(f.calls.some(c => c[0] === 'resizable' && c[1]), false);
  assert.deepEqual(f.calls.at(-1), ['opacity', 1]);
});
test('temporary work-area query failures still reopen the Console at its last known bounds', async t => {
  const f = fixture(t, { areas: async () => { throw new Error('IPC timeout'); } });
  await f.state.show();
  assert.equal(f.errors[0].message, 'IPC timeout');
  assert.equal(f.win.isVisible(), true);
  assert.deepEqual(f.calls.find(c => c[0] === 'bounds')[1], original);
});
test('native non-wlroots Console restores coordinates without floating workarounds', async t => {
  const f = fixture(t, { backend: undefined }); await f.state.show();
  assert.equal(f.calls.some(c => ['float', 'opacity', 'resizable'].includes(c[0])), false);
  assert.deepEqual(f.calls.find(c => c[0] === 'bounds')[1], original);
});
test('Hyprland geometry requires this PID/title and a mapped floating window', async t => {
  const f = fixture(t); await f.state.show();
  const valid = { pid: 123, title: 'Annotate Console', floating: true, mapped: true, at: [-1600, 180], size: [400, 600] };
  const run = value => async () => ({ stdout: JSON.stringify(value) });
  assert.deepEqual(await ownedWindowBounds(f.win, 'hyprland', 123, run([{ ...valid, pid: 999, at: [0, 0] }, valid])), original);
  for (const change of [{ pid: 999 }, { title: 'Other' }, { floating: false }, { mapped: false }, { hidden: true }, { fullscreen: 1 }]) {
    assert.equal(await ownedWindowBounds(f.win, 'hyprland', 123, run([{ ...valid, ...change }])), undefined);
  }
});
test('Sway geometry finds only owned floating descendants, not tiled windows', async t => {
  const f = fixture(t); await f.state.show();
  const node = { pid: 123, name: 'Annotate Console', rect: original };
  const run = async () => ({ stdout: JSON.stringify({ nodes: [{ ...node, rect: { x: 0, y: 0, width: 1000, height: 1000 } }], floating_nodes: [{ nodes: [node] }] }) });
  assert.deepEqual(await ownedWindowBounds(f.win, 'sway', 123, run), original);
});
