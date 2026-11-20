import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PILL_SIZES, layoutBounds, besideBounds, timelineSize } = require('../app/console-layout.cjs');
const { dockBounds } = require('../app/console-snap.cjs');
const { validateSettings, DEFAULTS } = require('../app/settings.cjs');
const area = { x: 0, y: 25, width: 1440, height: 875 }, areas = [area];

test('timeline feed is the default design', () => { assert.equal(DEFAULTS.consoleLayout, 'timeline'); assert.equal(validateSettings({ countdownSeconds: 1 }).consoleLayout, 'timeline'); });
test('timeline window spans about 60% of the available height, docked right on first use', () => {
  assert.deepEqual(timelineSize(area), { width: 320, height: 525 });
  assert.deepEqual(layoutBounds({}, areas, 'timeline', { initial: true }), { width: 320, height: 525, x: 1440 - 6 - 320, y: 25 + 175 });
});
test('docking the timeline keeps the 60% height at the dropped position, not the full height', () => {
  assert.deepEqual(dockBounds({ x: 10, y: 300, width: 320, height: 400 }, areas, { heightRatio: 0.6 }), { side: 'left', x: 6, y: 300, width: 320, height: 525 });
  assert.deepEqual(dockBounds({ x: 10, y: 800, width: 320, height: 400 }, areas, { heightRatio: 0.6 }).y, 25 + 875 - 6 - 525);
});
test('switching designs keeps position: pill sizes are fixed, timeline returns to its docked edge', () => {
  const pill = layoutBounds({ x: 1114, y: 200, width: 320, height: 525 }, areas, 'pill');
  assert.deepEqual(pill, { ...PILL_SIZES.collapsed, x: 1440 - 600, y: 200 });
  assert.deepEqual(layoutBounds(pill, areas, 'pill', { mode: 'expanded' }), { ...PILL_SIZES.expanded, x: 840, y: 200 });
  assert.equal(layoutBounds({ ...pill, y: 800 }, areas, 'pill', { mode: 'settings' }).y, 25 + 875 - 520);
  assert.deepEqual(layoutBounds(pill, areas, 'timeline'), { width: 320, height: 525, x: 1114, y: 200 });
  assert.deepEqual(layoutBounds({ x: 300, y: 100, width: 600, height: 56 }, areas, 'timeline'), { width: 320, height: 525, x: 300, y: 100 });
});
test('detail popup opens beside the Console, level with the entry, on the side with room', () => {
  const right = { x: 1114, y: 200, width: 320, height: 525 };
  assert.deepEqual(besideBounds(right, areas, { top: 120 }), { side: 'left', x: 1114 - 8 - 640, y: 320, width: 640, height: 560 });
  const left = { x: 6, y: 200, width: 320, height: 525 };
  assert.deepEqual(besideBounds(left, areas, { top: 120 }), { side: 'right', x: 334, y: 320, width: 640, height: 560 });
  // Clamped to stay on screen near the bottom.
  assert.equal(besideBounds(right, areas, { top: 500 }).y, 25 + 875 - 6 - 560);
  // Small screens: the popup shrinks to fit.
  const small = besideBounds({ x: 10, y: 0, width: 320, height: 400 }, [{ x: 0, y: 0, width: 800, height: 500 }], { top: 0 });
  assert.equal(small.height, 488); assert.ok(small.x >= 6 && small.x + small.width <= 794);
});
