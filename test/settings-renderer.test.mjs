// Run the actual merged toolbar renderer; no Electron, desktop or model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
const start = source.indexOf("if (page === 'toolbar') {");
const end = source.indexOf('// Both the adjacent', start);
async function renderer() {
  const nodes = new Map(), handlers = new Map(), keyboard = new Map(), sent = [];
  let onChange, saves = 0, failure;
  const state = { project: '/test', settings: { countdownSeconds: 1, captureMode: 'live', maxAnnotations: 8, defaultDeliverAs: 'followUp' }, preservedCaptureAvailable: true, drafts: [], shortcut: 'Cmd+A', shortcutReady: true, sending: false, capturing: false, backend: 'hyprland', destinations: [{ id: 'test', project: '/test' }], destinationId: 'test', destinationAvailable: true };
  function element() { return { value: '', hidden: false, disabled: false, dataset: {}, children: [], attributes: {}, textContent: '', title: '', classList: { toggle() {} }, append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener() {}, focus() { this.focused = true; }, reportValidity: () => true }; }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  $('settings').hidden = true;
  const api = { state: async () => structuredClone(state), onChange: fn => { onChange = fn; }, onNotice() {}, async settings(next) { saves++; if (failure) throw new Error(failure); state.settings = { ...next }; }, select: async () => {}, target: async () => {}, send: async (...args) => sent.push(args) };
  await vm.runInNewContext('(async()=>{' + source.slice(start, end) + '})()', { page: 'toolbar', api, $, document: { createElement: element }, window: { addEventListener: (key, fn) => keyboard.set(key, fn) }, navigator: { platform: 'Mac' }, projectLabel: path => path, action: (id, fn) => handlers.set(id, fn), report: error => { throw error; } });
  return { $, state, handlers, sent, keyboard, get saves() { return saves; }, fail: text => { failure = text; }, async refresh() { onChange(); await new Promise(resolve => setImmediate(resolve)); } };
}
test('settings combine live/preserved, countdown, limits and delivery default with draft-safe Cancel/Save', async () => {
  const r = await renderer();
  assert.equal(r.$('delivery-mode').value, 'followUp');
  await r.handlers.get('toggle-settings')();
  assert.equal(r.$('capture-mode').value, 'live'); assert.equal(r.$('max-annotations').value, 8);
  r.$('capture-mode').value = 'preserved'; r.$('max-annotations').value = 3;
  await r.handlers.get('cancel-settings')(); assert.equal(r.saves, 0);
  await r.handlers.get('toggle-settings')();
  r.$('capture-countdown').value = 4; r.$('capture-mode').value = 'preserved'; r.$('max-annotations').value = 4; r.$('default-delivery').value = 'steer';
  await r.handlers.get('save-settings')();
  assert.equal(r.saves, 1);
  assert.deepEqual(r.state.settings, { countdownSeconds: 4, captureMode: 'preserved', maxAnnotations: 4, defaultDeliverAs: 'steer' });
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
