import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationForRegion, relativeMark, placeNote, validateMark, commitEntry } from '../app/workflow.mjs';

test('a mark selects its containing entire app, never the mark-sized screenshot', () => {
  const app = { x: -1200, y: 100, width: 1000, height: 800, label: 'Browser' };
  const mark = { x: -1100, y: 300, width: 200, height: 160 };
  assert.equal(applicationForRegion(mark, [app]), app);
  assert.deepEqual(relativeMark(mark, app), [[.1, .25], [.3, .45]]);
  assert.throws(() => applicationForRegion({ ...mark, x: -1300 }, [app]), /inside one application/);
});
test('visible floating apps take precedence over underlying tiled apps', () => {
  const tiled = { x: 0, y: 0, width: 1200, height: 900, focusOrder: 0 };
  const floating = { x: 100, y: 100, width: 800, height: 500, floating: true, focusOrder: 2 };
  assert.equal(applicationForRegion({ x: 150, y: 150, width: 100, height: 100 }, [tiled, floating]), floating);
});
test('note goes beside the mark on its own monitor, including negative origins', () => {
  const areas = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }];
  const mark = { x: -1700, y: 100, width: 200, height: 100 };
  const note = placeNote(mark, areas);
  assert.equal(note.x, -1488); assert.equal(note.y, 100);
  assert.ok(note.x + note.width <= 0);
  const right = placeNote({ x: 1700, y: 100, width: 180, height: 100 }, areas);
  assert.ok(right.x + right.width < 1700);
});
test('note is clamped onscreen near corners and on small work areas', () => {
  for (const mark of [{ x: 790, y: 590, width: 10, height: 10 }, { x: 0, y: 0, width: 800, height: 600 }]) {
    const p = placeNote(mark, [{ x: 0, y: 0, width: 800, height: 600 }]);
    assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.width <= 800 && p.y + p.height <= 600);
  }
  assert.deepEqual(placeNote({ x: 0, y: 0, width: 100, height: 100 }, [{ x: 0, y: 0, width: 200, height: 150 }]), { x: 0, y: 0, width: 200, height: 150 });
});
test('replacement preserves identity/order/count; retake-as-new appends', () => {
  const old = [{ id: 'a', image: 'old-app-and-mark', comment: 'old' }, { id: 'b', image: 'b', comment: 'keep' }];
  const entry = { image: 'new-app-and-mark', comment: 'new' };
  const replaced = commitEntry(old, entry, 'a', 'unused');
  assert.deepEqual(replaced, [{ ...entry, id: 'a' }, old[1]]);
  assert.equal(old[0].image, 'old-app-and-mark', 'no mutation before a successful commit');
  assert.deepEqual(commitEntry(old, entry, undefined, 'c'), [...old, { ...entry, id: 'c' }]);
  assert.throws(() => commitEntry(old, entry, 'missing', 'c'), /no longer exists/);
});
test('a full batch allows replacement but not a thirteenth annotation', () => {
  const entries = Array.from({ length: 12 }, (_, i) => ({ id: String(i) }));
  assert.equal(commitEntry(entries, { image: 'replacement' }, '0', 'new').length, 12);
  assert.throws(() => commitEntry(entries, {}, undefined, 'new'), /12 per batch/);
});
test('marks validate against the full app coordinate space', () => {
  assert.deepEqual(validateMark('rectangle', [[.1, .2], [.5, .7]]), [[.1, .2], [.5, .7]]);
  assert.equal(validateMark('freehand', [[.1, .2], [.5, .7], [.8, .3]]).length, 3);
  for (const [kind, points] of [['crop', [[0, 0], [1, 1]]], ['rectangle', [[0, 0], [NaN, 1]]], ['rectangle', [[0, 0], [2, 1]]], ['rectangle', [[0, 0], [.001, .001]]]]) assert.throws(() => validateMark(kind, points));
});
