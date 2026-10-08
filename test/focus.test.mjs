import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../app/main.cjs', import.meta.url), 'utf8');
const factory = source.slice(source.indexOf('function windowFor('), source.indexOf('function authorize('));
function open(page, platform = 'darwin') {
  let options, ready, focused; const calls = [], levels = [], workspaces = [];
  class BrowserWindow {
    constructor(value) { options = value; this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    on(event, fn) { if (event === 'focus') focused = fn; }
    once(event, fn) { if (event === 'ready-to-show') ready = fn; }
    isDestroyed() { return false; }
    setVisibleOnAllWorkspaces(...args) { workspaces.push(args); }
    setAlwaysOnTop(...args) { levels.push(args); }
    loadFile() {}
    showInactive() { calls.push('inactive'); }
    show() { calls.push('show'); }
    focus() { calls.push('focus'); }
  }
  runInNewContext(factory + `\nwindowFor('${page}', 'Test', {width:800,height:600});`, {
    BrowserWindow, process: { platform }, backend: null, desktopBackdrop: undefined, windows: new Set(), join: (...args) => args.join('/'), __dirname: '/test',
    initialConsoleBounds: { width: 400, height: 600 }, busy: () => false, consoleAreas() {}, ownedWindowBounds() {}, enforceFloating() {}, saveBounds() {}, consolePlacement: () => ({ show: () => calls.push('console') }),
  });
  ready(); return { options, calls, levels, workspaces, focused };
}
test('macOS selection panel shows without activation and still accepts mouse input', () => {
  const { options, calls } = open('desktop');
  assert.equal(options.type, 'panel');
  assert.equal(options.focusable, false);
  assert.equal(options.acceptFirstMouse, true);
  assert.deepEqual(calls, ['inactive']);
});
test('note input can still focus; other platform selectors retain their behavior', () => {
  assert.deepEqual(open('note').calls, ['show', 'focus']);
  assert.deepEqual(open('desktop', 'win32').calls, ['show', 'focus']);
});
test('macOS Console, note and highlight panels join fullscreen Spaces and keep their level on focus', () => {
  for (const page of ['toolbar', 'note', 'mark', 'desktop']) {
    const f = open(page);
    assert.equal(f.options.type, 'panel');
    assert.equal(f.workspaces[0][0], true); assert.equal(f.workspaces[0][1].visibleOnFullScreen, true);
    f.focused();
    assert.deepEqual(f.levels, [[true, 'screen-saver'], [true, 'screen-saver']]);
  }
  assert.equal(open('note', 'win32').levels[0][1], 'floating');
});
