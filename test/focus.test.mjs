import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../app/main.cjs', import.meta.url), 'utf8');
const factory = source.slice(source.indexOf('function windowFor('), source.indexOf('function authorize('));
function open(page, platform = 'darwin') {
  let options, ready; const calls = [];
  class BrowserWindow {
    constructor(value) { options = value; this.webContents = { setWindowOpenHandler() {}, on() {} }; }
    on() {}
    once(event, fn) { if (event === 'ready-to-show') ready = fn; }
    isDestroyed() { return false; }
    setVisibleOnAllWorkspaces() {}
    loadFile() {}
    showInactive() { calls.push('inactive'); }
    show() { calls.push('show'); }
    focus() { calls.push('focus'); }
  }
  runInNewContext(factory + `\nwindowFor('${page}', 'Test', {width:800,height:600});`, {
    BrowserWindow, process: { platform }, backend: null, windows: new Set(), join: (...args) => args.join('/'), __dirname: '/test',
  });
  ready(); return { options, calls };
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
