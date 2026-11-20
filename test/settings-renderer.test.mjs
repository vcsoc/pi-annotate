// Run the actual merged toolbar renderer; no Electron, desktop or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { recordShortcut, matchesShortcut } from '../app/shortcut-keys.mjs';
const source = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
const start = source.indexOf("if (page === 'toolbar') {");
const end = source.indexOf('// Both the adjacent', start);
async function renderer() {
  const nodes = new Map(), handlers = new Map(), keyboard = new Map(), sent = [];
  let onChange, saves = 0, failure; const recordings = [], shortcutCaptures = [], sizes = [];
  const state = { project: '/test', settings: { countdownSeconds: 1, captureMode: 'live', maxAnnotations: 8, defaultDeliverAs: 'followUp', captureShortcut: '', globalShortcut: true }, defaultShortcut: 'CommandOrControl+Shift+A', preservedCaptureAvailable: true, drafts: [], shortcut: 'Cmd+A', shortcutReady: true, shortcutGlobal: true, sending: false, capturing: false, backend: 'hyprland', destinations: [{ id: 'test', project: '/test' }], destinationId: 'test', destinationAvailable: true };
  function element() { const node = { value: '', hidden: false, disabled: false, dataset: {}, children: [], attributes: {}, textContent: '', title: '', classList: { toggle(name, on) { (this.owner.classes ||= {})[name] = on; } }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(type, fn) { (this.listeners ||= {})[type] = fn; }, focus() { this.focused = true; }, reportValidity: () => true }; node.classList.owner = node; return node; }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  $('settings').hidden = true;
  const api = { state: async () => structuredClone(state), onChange: fn => { onChange = fn; }, onNotice() {}, async settings(next) { saves++; if (failure) throw new Error(failure); state.settings = { ...state.settings, ...next }; state.shortcut = state.settings.captureShortcut || state.defaultShortcut; state.shortcutGlobal = state.settings.globalShortcut !== false; }, select: async () => {}, target: async () => {}, send: async (...args) => sent.push(args), consoleSize: async mode => { sizes.push(mode); }, shortcutRecording: async active => { recordings.push(active); }, shortcutCapture: async () => { shortcutCaptures.push(true); } };
  await vm.runInNewContext('(async()=>{' + source.slice(start, end) + '})()', { page: 'toolbar', api, $, document: { createElement: element }, window: { addEventListener: (key, fn) => keyboard.set(key, fn) }, navigator: { platform: 'Mac' }, projectLabel: path => path, recordShortcut, matchesShortcut, action: (id, fn) => handlers.set(id, fn), report: error => { throw error; } });
  return { $, state, handlers, sent, keyboard, recordings, shortcutCaptures, sizes, get saves() { return saves; }, fail: text => { failure = text; }, async refresh() { onChange(); await new Promise(resolve => setImmediate(resolve)); } };
}
test('settings combine live/preserved, countdown, limits and delivery default with draft-safe Cancel/Save', async () => {
  const r = await renderer();
  assert.equal(r.$('delivery-mode').value, 'followUp');
  await r.handlers.get('toggle-settings')();
  assert.equal(r.$('capture-mode').value, 'live'); assert.equal(r.$('max-annotations').value, 8);
  assert.equal(r.$('capture-shortcut').placeholder, r.state.defaultShortcut);
  r.$('capture-shortcut').value = 'Control+F8';
  r.$('capture-mode').value = 'preserved'; r.$('max-annotations').value = 3;
  await r.handlers.get('cancel-settings')(); assert.equal(r.saves, 0);
  await r.handlers.get('toggle-settings')();
  assert.equal(r.$('capture-shortcut').value, '');
  r.$('capture-shortcut').value = 'Control+Alt+F9';
  r.$('capture-countdown').value = 4; r.$('capture-mode').value = 'preserved'; r.$('max-annotations').value = 4; r.$('default-delivery').value = 'steer';
  await r.handlers.get('save-settings')();
  assert.equal(r.saves, 1);
  assert.deepEqual(r.state.settings, { countdownSeconds: 4, captureMode: 'preserved', maxAnnotations: 4, defaultDeliverAs: 'steer', captureShortcut: 'Control+Alt+F9', globalShortcut: true, consoleLayout: 'timeline', markTool: 'freehand', markOverflow: 'clip' });
  assert.equal(r.$('shortcut').textContent, '⌃⌥F9');
  assert.equal(r.$('settings').hidden, true); assert.equal(r.$('delivery-mode').value, 'steer');
  assert.match(r.$('capture').title, /Preserved frame/);
});
test('refresh preserves unsaved settings and per-batch mode, and Send includes destination and mode', async () => {
  const r = await renderer(); r.$('delivery-mode').value = 'steer';
  await r.handlers.get('toggle-settings')(); r.$('capture-countdown').value = 7;
  await r.refresh(); assert.equal(r.$('capture-countdown').value, 7); assert.equal(r.$('delivery-mode').value, 'steer');
  await r.handlers.get('cancel-settings')(); await r.handlers.get('send')();
  assert.deepEqual(r.sent[0], ['test', 'steer']);
  r.state.capturing = true; await r.refresh(); assert.equal(r.$('toggle-settings').disabled, true); assert.equal(r.$('delivery-mode').disabled, true);
  await r.handlers.get('toggle-settings')(); assert.equal(r.$('settings').hidden, true);
});
test('failed saves preserve edited settings and Escape cancels without writing', async () => {
  const r = await renderer(); await r.handlers.get('toggle-settings')();
  r.$('max-annotations').value = 4; r.fail('There are 5 unsent annotations');
  await r.handlers.get('save-settings')();
  assert.equal(r.$('settings').hidden, false); assert.equal(r.$('max-annotations').value, 4);
  assert.match(r.$('settings-status').textContent, /unsent/); assert.equal(r.state.settings.maxAnnotations, 8);
  r.keyboard.get('keydown')({ key: 'Escape', preventDefault() {} });
  assert.equal(r.$('settings').hidden, true); assert.equal(r.saves, 1);
});
test('preserved capture is visibly unavailable on unsupported desktops without erasing the saved preference', async () => {
  const r = await renderer(); r.state.preservedCaptureAvailable = false; r.state.settings.captureMode = 'preserved';
  await r.refresh(); await r.handlers.get('toggle-settings')();
  assert.equal(r.$('capture-mode').disabled, true); assert.equal(r.$('capture-mode').value, 'preserved');
  assert.match(r.$('capture').title, /Live marking/);
});
const key = (code, mods = {}, keyName = code) => ({ code, key: keyName, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
test('focused shortcut field records the pressed combination and applies it immediately', async () => {
  const r = await renderer(); await r.handlers.get('toggle-settings')();
  const field = r.$('capture-shortcut'), on = field.listeners, settle = () => new Promise(resolve => setImmediate(resolve));
  on.focus(); assert.deepEqual(r.recordings, [true]);
  assert.match(r.$('shortcut-status').textContent, /Press the new key combination/);
  on.keydown(key('MetaLeft', { metaKey: true }, 'Meta')); assert.equal(field.value, 'CommandOrControl+…');
  on.keyup(key('MetaLeft', {}, 'Meta')); assert.equal(field.value, '');
  assert.equal(r.saves, 0);
  const typed = key('KeyK', { metaKey: true, shiftKey: true }, 'K'); on.keydown(typed); await settle();
  assert.equal(typed.defaultPrevented, true); assert.equal(field.value, 'CommandOrControl+Shift+K');
  assert.equal(r.saves, 1); assert.equal(r.state.settings.captureShortcut, 'CommandOrControl+Shift+K');
  assert.match(r.$('shortcut-status').textContent, /Saved\. ⌘⇧K now starts a capture from any app/);
  on.keydown(key('KeyJ', {}, 'j')); await settle(); assert.equal(field.value, 'CommandOrControl+Shift+K'); assert.match(r.$('shortcut-status').textContent, /Hold/);
  on.keydown(key('Backspace')); await settle(); assert.equal(field.value, ''); assert.equal(r.state.settings.captureShortcut, '');
  on.keydown(key('Backquote', { ctrlKey: true }, '`')); await settle();
  assert.equal(r.state.settings.captureShortcut, 'Control+`');
  r.$('global-shortcut').checked = false; r.$('global-shortcut').listeners.change(); await settle();
  assert.equal(r.state.settings.globalShortcut, false); assert.match(r.$('shortcut-status').textContent, /while the Console is focused/);
  on.blur(); assert.deepEqual(r.recordings, [true, false]);
  // Cancel keeps what was already applied; reopening shows it.
  await r.handlers.get('cancel-settings')(); await r.handlers.get('toggle-settings')();
  assert.equal(field.value, 'Control+`'); assert.equal(r.$('global-shortcut').checked, false);
});
test('a rejected shortcut shows its error beside the field and keeps the active one', async () => {
  const r = await renderer(); await r.handlers.get('toggle-settings')();
  const on = r.$('capture-shortcut').listeners; on.focus();
  r.fail('Cannot register Control+F1. It may be reserved.');
  on.keydown(key('F1', { ctrlKey: true }, 'F1')); await new Promise(resolve => setImmediate(resolve));
  assert.match(r.$('shortcut-status').textContent, /Cannot register/); assert.equal(r.$('capture-shortcut').value, '');
});
test('Console-only shortcut captures from the focused Console; global mode leaves it to the OS', async () => {
  const r = await renderer(); r.state.shortcut = 'CommandOrControl+Shift+A';
  await r.refresh(); r.keyboard.get('keydown')(key('KeyA', { metaKey: true, shiftKey: true }, 'A'));
  assert.equal(r.shortcutCaptures.length, 0);
  r.state.shortcutGlobal = false; await r.refresh();
  r.keyboard.get('keydown')(key('KeyB', { metaKey: true, shiftKey: true }, 'B'));
  r.keyboard.get('keydown')(key('KeyA', { metaKey: true, shiftKey: true }, 'A'));
  assert.equal(r.shortcutCaptures.length, 1);
});
test('command pill design: tray and settings request fixed window sizes', async () => {
  const r = await renderer(); assert.equal(r.$('toolbar').classes['layout-timeline'], true);
  r.state.settings.consoleLayout = 'pill'; await r.refresh();
  assert.equal(r.$('toolbar').classes['layout-pill'], true); assert.equal(r.$('toolbar').classes['layout-timeline'], false);
  assert.equal(r.$('meter-count').textContent, '0/8');
  await r.handlers.get('tray-toggle')(); assert.deepEqual(r.sizes, ['expanded']); assert.equal(r.$('toolbar').classes['tray-open'], true);
  await r.handlers.get('toggle-settings')(); assert.equal(r.sizes.at(-1), 'settings'); assert.equal(r.$('console-layout').value, 'pill');
  await r.handlers.get('cancel-settings')(); assert.equal(r.sizes.at(-1), 'expanded');
  await r.handlers.get('tray-toggle')(); assert.equal(r.sizes.at(-1), 'collapsed');
});
