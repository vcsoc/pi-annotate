import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const { normalizeWindows, sourceForWindow, nativeWindows } = require('../app/native-windows.cjs');
const { selection, pointsInApp } = require('../app/desktop-selection.cjs');
const displays = [{ x: -1920, y: -200, width: 1920, height: 1080 }, { x: 0, y: 0, width: 2560, height: 1440 }];

test('native desktop marks retain negative monitor origins and app-relative coordinates', () => {
  const mark = selection('rectangle', [[-1500, 100], [-1200, 300]], displays);
  assert.deepEqual(mark.region, { x: -1500, y: 100, width: 300, height: 200 });
  assert.deepEqual(pointsInApp(mark.points, { x: -1600, y: 0, width: 800, height: 600 }), [[.125, 1/6], [.5, .5]]);
});
test('freehand and cross-output rectangles use the same desktop selection pipeline', () => {
  assert.equal(selection('freehand', [[-100, 100], [100, 200], [200, 100]], displays).points.length, 3);
  assert.deepEqual(selection('rectangle', [[-100, 100], [100, 200]], displays).region, { x: -100, y: 100, width: 200, height: 100 });
  for (const points of [[], [[0,0],[1,1]], [[0,0],[NaN,30]], [[0,0],[99999,30]]]) assert.throws(() => selection('rectangle', points, displays));
});
test('window normalization excludes companion windows and converts Windows physical bounds once', () => {
  const rows = [{ id: '42', pid: 10, x: -200, y: 100, width: 1600, height: 1200, title: 'App' }, { id: '43', pid: 99, x: 0, y: 0, width: 800, height: 400 }];
  const result = normalizeWindows(rows, 99, b => Object.fromEntries(Object.entries(b).map(([k,v]) => [k,v/2])));
  assert.equal(result.length, 1); assert.equal(result[0].x, -100); assert.equal(result[0].width, 800); assert.equal(result[0].nativeId, '42');
});
test('capture matches exact native window ID, never primary screen or first available source', () => {
  const sources = [{ id: 'screen:0:0' }, { id: 'window:1:0' }, { id: 'window:42:0' }];
  assert.equal(sourceForWindow(sources, { nativeId: '42' }), sources[2]);
  assert.throws(() => sourceForWindow(sources, { nativeId: '99' }), /not available/);
});
test('macOS window discovery uses the OS helper without launching a screenshot editor', async () => {
  let command;
  const rows = [{ id: '100', pid: 5, x: -100, y: 20, width: 1000, height: 600, title: 'Mac app', order: 0 }];
  const result = await nativeWindows('darwin', 99, {}, undefined, async (...args) => { command = args; return { stdout: JSON.stringify(rows) }; });
  assert.equal(command[0], '/usr/bin/osascript'); assert.ok(command[1].at(-1).endsWith('windows-macos.js')); assert.equal(result[0].nativeId, '100');
});
test('macOS helper bridges CFArrayRef to NSArray before unwrapping', () => {
  const ref = {}, array = {}, rows = [{ kCGWindowLayer: 0, kCGWindowAlpha: 1, kCGWindowNumber: 42, kCGWindowOwnerPID: 5, kCGWindowOwnerName: 'App', kCGWindowBounds: { X: -100, Y: 20, Width: 800, Height: 600 } }];
  const output = runInNewContext(readFileSync(new URL('../app/native/windows-macos.js', import.meta.url), 'utf8'), {
    ObjC: { import() {}, castRefToObject(value) { assert.equal(value, ref); return array; }, deepUnwrap(value) { assert.equal(value, array); return rows; } },
    $: { CGWindowListCopyWindowInfo() { return ref; } },
  });
  assert.deepEqual(JSON.parse(output), [{ id: '42', pid: 5, title: 'App', x: -100, y: 20, width: 800, height: 600, order: 0 }]);
});
test('Windows helper bounds are converted through Electron screenToDipRect', async () => {
  const rows = [{ id: '12345', pid: 5, x: 2000, y: 200, width: 1600, height: 900, title: 'Windows app' }];
  let converted = false;
  const result = await nativeWindows('win32', 99, { screenToDipRect: (win, rect) => { assert.equal(win, null); converted = true; return { ...rect, x: 1000, width: 800 }; } }, undefined, async () => ({ stdout: '\uFEFF' + JSON.stringify(rows) }));
  assert.equal(converted, true); assert.equal(result[0].width, 800);
});
test('X11 discovery respects active workspace and front-to-back stacking', async () => {
  const result = await nativeWindows('linux', 99, {}, undefined, async (command, args) => ({ stdout: command === 'xprop' ? '_NET_CLIENT_LIST_STACKING(WINDOW): window id # 0x10, 0x20' : args[0] === '-d' ? '0 * DG: 1920x1080\n1 - DG: 1920x1080' : '0x10 0 10 0 0 800 600 host App A\n0x20 0 11 20 20 600 400 host App B\n0x30 1 12 0 0 800 600 host Hidden' }));
  assert.equal(result.length, 2); assert.equal(result[1].focusOrder, 0);
});
test('primary Capture routes no longer invoke a source picker, portal or frozen editor', () => {
  const main = readFileSync(new URL('../app/main.cjs', import.meta.url), 'utf8');
  const capture = main.slice(main.indexOf('async function capture('), main.indexOf("handle('portal-ready'"));
  assert.match(capture, /selectOnDesktop\(kind\)/); assert.match(capture, /await openLiveNote\(region\)/);
  assert.doesNotMatch(capture, /await pickDesktopSource\(|await portalCapture\(|openEditor\(/);
});
