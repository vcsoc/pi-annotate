import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cropRectangle } from '../app/geometry.mjs';
const require = createRequire(import.meta.url);
const { parseGeometry, geometry, visibleHyprWindows, visibleSwayWindows, nativeChoices, TOOLBAR_WIDTH, TOOLBAR_HEIGHT } = require('../app/capture-adapters.cjs');

test('Annotate Console uses bounded floating-window dimensions', () => {
  assert.equal(TOOLBAR_WIDTH, 800); assert.equal(TOOLBAR_HEIGHT, 400);
});
test('region geometry preserves negative monitor offsets and spans across outputs', () => {
  assert.deepEqual(parseGeometry('-1920,-200 3840x1080\n'), { x: -1920, y: -200, width: 3840, height: 1080 });
  assert.equal(geometry(parseGeometry('1919,100 640x360')), '1919,100 640x360');
  for (const input of ['0,0 1x1', '0,0 0x100', '0,0 999999x1', '0,0 100x100; touch /tmp/evil', 'junk']) assert.throws(() => parseGeometry(input));
});
test('Hyprland window-click candidates include active windows on EVERY monitor, never our toolbar', () => {
  const monitors = [{ activeWorkspace: { id: 1 }, specialWorkspace: { id: 0 } }, { activeWorkspace: { id: 2 }, specialWorkspace: { id: -3 } }];
  const client = (pid, workspace, at, extra = {}) => ({ pid, mapped: true, hidden: false, workspace: { id: workspace }, at, size: [700, 500], title: `App ${pid}`, ...extra });
  const boxes = visibleHyprWindows([client(1, 1, [-1920, 100]), client(2, 2, [1919, 100]), client(3, -3, [2000, 200]), client(4, 9, [0, 0]), client(5, 1, [0, 0], { hidden: true }), client(99, 2, [2000, 100]), client(6, 8, [0, 0], { pinned: true })], monitors, 99);
  assert.deepEqual(boxes.map(b => b.label), ['App 1', 'App 2', 'App 3', 'App 6']);
  assert.equal(boxes[0].x, -1920); assert.equal(boxes[1].x, 1919);
});
test('Sway capture boxes exclude hidden workspaces and the companion', () => {
  const window = pid => ({ pid, name: `App ${pid}`, app_id: 'test', rect: { x: 0, y: 0, width: 100, height: 100 } });
  const tree = { nodes: [{ type: 'workspace', visible: true, nodes: [window(1), window(99)] }, { type: 'workspace', visible: false, nodes: [window(2)] }] };
  assert.deepEqual(visibleSwayWindows(tree, 99).map(b => b.label), ['App 1']);
});
test('native picker lists all screens AND app windows rather than choosing primary implicitly', () => {
  const source = (id, name, display_id = '') => ({ id, name, display_id, thumbnail: { toDataURL: () => 'data:image/png;base64,test' } });
  const choices = nativeChoices([source('screen:1:0', 'Monitor 1', '1'), source('screen:2:0', 'Monitor 2', '2'), source('window:20:0', 'App on monitor 2'), source('window:30:0', 'Pi Annotate')]);
  assert.deepEqual(choices.map(s => s.id), ['screen:1:0', 'screen:2:0', 'window:20:0']);
  assert.equal(choices[2].type, 'window');
});
test('capture crop maps displayed selection to source pixels, not monitor or primary coordinates', () => {
  assert.deepEqual(cropRectangle([[0.75, 0.8], [0.25, 0.2]], 1920, 1080), { x: 480, y: 216, width: 960, height: 648 });
  assert.deepEqual(cropRectangle([[0, 0], [1, 1]], 3840, 2160), { x: 0, y: 0, width: 3840, height: 2160 });
  for (const points of [[], [[0, 0], [NaN, 1]], [[0, 0], [2, 1]], [[0, 0], [0, 0]]]) assert.throws(() => cropRectangle(points, 1920, 1080));
});
