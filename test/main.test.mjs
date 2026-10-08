// IPC integration tests run the real companion controller in a VM with Electron
// stubbed. No browser, GPU, desktop capture, shortcuts or network are started.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const filename = fileURLToPath(new URL('../app/main.cjs', import.meta.url));
const require = createRequire(filename), source = readFileSync(filename, 'utf8');
function png(width = 640, height = 420) {
  // The controller validates header/size. Pixel composition is covered by the
  // opt-in real screenshot test; this fixture is not used to claim PNG rendering.
  const bytes = Buffer.alloc(33); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.write('IHDR', 12); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}
function controller(captureStubs = {}) {
  const handlers = new Map(), deferred = [], switches = new Map(), submissions = [], quits = [];
  const window = () => {
    let destroyed = false;
    return { webContents: { mainFrame: {}, send() {} }, isDestroyed: () => destroyed, show() {}, hide() {}, focus() {}, destroy() { destroyed = true; } };
  };
  const consoleWindow = window(), note = window();
  const electron = {
    app: { setName() {}, getPath: () => '/test-fixture-no-write', quit() { quits.push(true); }, commandLine: { appendSwitch: (key, value) => switches.set(key, value) }, whenReady: () => new Promise(() => {}), on() {} },
    ipcMain: { handle: (key, fn) => handlers.set(key, fn) },
    nativeImage: { createFromDataURL: image => ({ resize: () => ({ toDataURL: () => image }) }), createFromBuffer: captureStubs.decode || (() => { throw new Error('Unexpected native image decode'); }) },
  };
  const context = vm.createContext({
    require: name => {
      const deny = async () => { throw new Error('Native desktop calls are forbidden in non-GUI controller tests'); };
      if (name === 'electron') return electron;
      if (name === './capture-adapters.cjs') return { ...require(name), windowBoxes: captureStubs.windowBoxes || deny, selectRegion: captureStubs.selectRegion || deny, enforceFloating: deny, workAreas: captureStubs.workAreas || deny };
      if (name === './capture-wlroots.cjs') return { ...require(name), snapshotDesktop: captureStubs.snapshotDesktop || deny, readDisplayBounds: captureStubs.readDisplayBounds || deny, waitForCapture: captureStubs.waitForCapture || require(name).waitForCapture };
      if (name === './settings.cjs') return { ...require(name), saveSettings: captureStubs.saveSettings || require(name).saveSettings };
      if (name === './native-windows.cjs') return { ...require(name), nativeWindows: deny };
      if (name === 'node:child_process') return { execFile: captureStubs.execFile || ((...args) => args.at(-1)(new Error('Subprocesses are forbidden in controller tests'))) };
      return require(name);
    }, __dirname: dirname(filename), Buffer, console,
    process: { platform: 'linux', pid: 123, env: { PI_ANNOTATE_URL: 'http://127.0.0.1:12345', PI_ANNOTATE_TOKEN: 'a'.repeat(64), WAYLAND_DISPLAY: 'test-only', XDG_CURRENT_DESKTOP: 'Hyprland' }, on() {}, exit() { throw new Error('Unexpected exit'); } },
    setTimeout, clearTimeout, setImmediate: fn => deferred.push(fn), AbortController, AbortSignal,
    fetch: async (_url, options) => { submissions.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ count: 1, savedTo: '/test' }) }; },
    consoleWindow, note,
  });
  new vm.Script(source, { filename, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER }).runInContext(context);
  vm.runInContext("toolbar = consoleWindow; noteWindow = note; windows.add(toolbar); windows.add(note); info = { project: '/test', shortcut: 'test' };", context);
  const invoke = (name, args = [], target = note) => handlers.get(name)({ sender: target.webContents, senderFrame: target.webContents.mainFrame }, ...args);
  const evaluate = expression => vm.runInContext(expression, context);
  const seed = (replaceId, existing = []) => {
    context.seedDrafts = existing; context.pending = { size: { width: 640, height: 420 }, image: 'data:image/png;base64,' + png(), source: 'Whole app', kind: 'rectangle', points: [[.1, .2], [.4, .5]], replaceId, needsAppBounds: false };
    evaluate('drafts = seedDrafts; frozen = pending; saving = false;');
  };
  return { invoke, evaluate, context, seed, submissions, switches, consoleWindow, quits, flush: () => { while (deferred.length) deferred.shift()(); } };
}
test('companion chooses native Wayland and corrects the reported wlroots DPI mismatch', () => {
  const c = controller(); assert.equal(c.switches.get('ozone-platform'), 'wayland'); assert.equal(c.switches.get('force-device-scale-factor'), '1');
});
test('Tick saves full-app evidence without submitting; duplicate concurrent Tick is refused', async () => {
  const c = controller(); c.seed();
  const first = c.invoke('add', [{ image: png(), comment: 'Change control' }]);
  await assert.rejects(c.invoke('add', [{ image: png(), comment: 'Duplicate' }]), /already in progress/);
  assert.equal((await first).count, 1); c.flush();
  assert.equal(c.evaluate('drafts.length'), 1); assert.equal(c.evaluate('drafts[0].width'), 640); assert.equal(c.evaluate('drafts[0].height'), 420);
  assert.equal(c.evaluate('frozen'), undefined); assert.equal(c.submissions.length, 0);
});
test('cropped-mark image is refused and the old retake entry survives a failed save', async () => {
  const c = controller(), old = { id: 'old', image: png(), comment: 'Keep me' }; c.seed('old', [old]);
  await assert.rejects(c.invoke('add', [{ image: png(180, 110), comment: 'Wrong crop' }]), /complete app/);
  assert.equal(c.evaluate('drafts[0]'), old); assert.equal(c.evaluate('saving'), false);
  assert.equal((await c.invoke('add', [{ image: png(), comment: 'Correct whole app' }])).count, 1);
  assert.equal(c.evaluate('drafts[0].id'), 'old'); assert.equal(c.evaluate('drafts[0].comment'), 'Correct whole app');
});
test('cancel during asynchronous validation cannot replace an existing annotation', async () => {
  const c = controller(), old = { id: 'old', image: png(), comment: 'Keep me' }; c.seed('old', [old]);
  const saving = c.invoke('add', [{ image: png(), comment: 'Must not replace' }]);
  await c.invoke('cancel'); await assert.rejects(saving, /Capture changed/);
  assert.equal(c.evaluate('drafts[0]'), old); assert.equal(c.evaluate('frozen'), undefined);
});
test('whole-app identification and marking are required before saving', async () => {
  const c = controller(); c.seed(); c.evaluate('frozen.needsAppBounds = true;');
  await assert.rejects(c.invoke('add', [{ image: png(), comment: 'Too soon' }]), /complete application/);
  c.evaluate('frozen.needsAppBounds = false; frozen.points = undefined;');
  await assert.rejects(c.invoke('add', [{ image: png(), comment: 'No mark' }]), /complete application/);
});
test('Send refuses pending captures; text editing preserves images; failed Send keeps the batch', async () => {
  const c = controller(); c.seed();
  await assert.rejects(c.invoke('send', [], c.consoleWindow), /Finish the current capture/);
  await c.invoke('add', [{ image: png(), comment: 'First' }]); c.flush();
  const id = c.evaluate('drafts[0].id'), image = c.evaluate('drafts[0].image');
  await c.invoke('comment', [id, 'Edited'], c.consoleWindow); assert.equal(c.evaluate('drafts[0].image'), image);
  c.context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Provider temporarily unavailable' }) });
  await assert.rejects(c.invoke('send', [], c.consoleWindow), /temporarily unavailable/);
  assert.equal(c.evaluate('drafts.length'), 1); assert.equal(c.evaluate('drafts[0].comment'), 'Edited'); assert.equal(c.evaluate('sending'), false);
  c.flush(); assert.equal(c.quits.length, 0, 'failed delivery must leave the Console open');
});
test('Send closes only after successful delivery and prevents another capture while closing', async () => {
  const c = controller(); c.seed();
  await c.invoke('add', [{ image: png(), comment: 'Ready to send' }]); c.flush();
  let complete;
  c.context.fetch = () => new Promise(resolve => { complete = resolve; });
  const sending = c.invoke('send', [], c.consoleWindow);
  c.flush(); assert.equal(c.quits.length, 0); assert.equal(c.evaluate('drafts.length'), 1);
  complete({ ok: true, json: async () => ({ count: 1 }) });
  assert.equal((await sending).count, 1); assert.equal(c.evaluate('drafts.length'), 0);
  assert.equal(c.quits.length, 0, 'IPC acknowledgment precedes shutdown');
  assert.equal(c.evaluate('busy()'), true);
  c.flush(); assert.equal(c.quits.length, 1); assert.equal(c.evaluate('quitting'), true);
});
test('Send warning is a persistent Console footer, not a confirmation dialog', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
  assert.match(html, /<footer id="privacy-warning">[\s\S]*?entire application[\s\S]*?sensitive information[\s\S]*?<\/footer>/);
  assert.doesNotMatch(renderer, /\bconfirm\s*\(/);
});
test('desktop selector IPC uses display-global geometry and refuses other windows/off-screen marks', async () => {
  const c = controller();
  c.context.completed = [];
  c.evaluate("selectors.set(note, { x: -1920, y: 0, width: 1920, height: 1080 }); desktopKind = 'rectangle'; finishDesktop = (error, mark) => completed.push(mark);");
  const config = await c.invoke('desktop-config'); assert.equal(config.bounds.x, -1920);
  await assert.rejects(c.invoke('desktop-config', [], c.consoleWindow), /No desktop selection/);
  await assert.rejects(c.invoke('desktop-mark', [[[0, 0], [9999, 9999]], true]), /connected displays/);
  await c.invoke('desktop-mark', [[[-1500, 100], [-1200, 300]], true]);
  assert.equal(c.context.completed.length, 1); assert.equal(c.context.completed[0].region.width, 300);
  assert.equal(c.context.completed[0].region.x, -1500); assert.equal(c.submissions.length, 0);
});
test('Send binds to the visible destination and refuses stale or offline selections without losing drafts', async () => {
  const c = controller(); c.seed();
  await c.invoke('add', [{ image: png(), comment: 'Keep this batch' }]); c.flush();
  c.evaluate("routeState = { selected: { id: 'new-target' }, available: true };");
  await assert.rejects(c.invoke('send', ['old-target'], c.consoleWindow), /Destination changed/);
  c.evaluate('routeState.available = false;');
  await assert.rejects(c.invoke('send', ['new-target'], c.consoleWindow), /offline/);
  assert.equal(c.evaluate('drafts.length'), 1); assert.equal(c.submissions.length, 0);
  c.evaluate('routeState.available = true;');
  await c.invoke('send', ['new-target'], c.consoleWindow);
  assert.equal(c.submissions[0].targetId, 'new-target');
});
test('Omarchy marks the live desktop before taking whole-app evidence, without a screenshot backdrop', () => {
  const branch = source.slice(source.indexOf('        // Live is the default:'), source.indexOf('    } else {\n      if (wayland'));
  assert.doesNotMatch(branch, /snapshotDesktop|frame\.crop|selectOnDesktop\(kind,/);
  assert.ok(branch.indexOf('await selectRegion') < branch.indexOf("await exec('grim'"));
  assert.match(branch, /await selectOnDesktop\(kind\)/);
  assert.match(branch, /geometry\(target\)/);
});
test('Console Capture uses the one-second default and configurable countdown', async () => {
  const c = controller(); c.context.requests = [];
  c.evaluate('capture = async options => requests.push(options);');
  await c.invoke('capture', [{ kind: 'rectangle', delayMs: 999 }], c.consoleWindow);
  assert.equal(c.context.requests[0].delayMs, 1000);
  c.evaluate('settings.countdownSeconds = 7;');
  await c.invoke('capture', [{}], c.consoleWindow);
  assert.equal(c.context.requests[1].delayMs, 7000);
});
test('preserved selectors wait for every painted backdrop before showing', async () => {
  const c = controller(), shown = [];
  c.context.note.showInactive = () => shown.push('note');
  c.consoleWindow.showInactive = () => shown.push('other');
  c.evaluate('desktopBackdrop = {}; selectors.set(note, {}); selectors.set(consoleWindow, {});');
  await c.invoke('desktop-ready'); assert.equal(shown.length, 0);
  await c.invoke('desktop-ready', [], c.consoleWindow);
  assert.deepEqual(shown, ['note', 'other']);
});
test('capture errors remain readable after the Console refreshes', async () => {
  const c = controller(); c.evaluate("status('Capture failed: example diagnostic');");
  assert.equal((await c.invoke('state')).notice, 'Capture failed: example diagnostic');
  await assert.rejects(c.invoke('settings', [{ countdownSeconds: 2 }]), /Only the Console/);
  await assert.rejects(c.invoke('developer-page'), /Only the Console/);
});
test('untrusted IPC sender cannot read or change the Console', async () => {
  const c = controller();
  await assert.rejects(c.invoke('state', [], { webContents: { mainFrame: {} } }), /Untrusted window/);
});

for (const mode of ['live', 'preserved']) for (const kind of ['rectangle', 'freehand']) {
  test(`${mode} ${kind} uses the expected capture order and retains the full app`, async () => {
    const calls = [], areas = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    const target = { x: 0, y: 0, width: 640, height: 420, label: 'Test app' };
    const region = { x: 100, y: 100, width: 200, height: 100 };
    const marked = { region, points: kind === 'rectangle' ? [[100, 100], [300, 200]] : [[100, 100], [300, 150], [150, 200]] };
    const image = { getSize: () => ({ width: 640, height: 420 }), toPNG: () => Buffer.from(png(), 'base64'), toDataURL: () => 'data:image/png;base64,' + png() };
    const frame = { areas, crop: box => { calls.push('crop'); assert.equal(box.width, 640); return image; }, preview() {} };
    const c = controller({
      windowBoxes: async () => [target], readDisplayBounds: async () => areas,
      snapshotDesktop: async () => { calls.push('snapshot'); return frame; },
      selectRegion: async () => { calls.push('slurp'); return region; },
      execFile: (command, args, options, callback) => { calls.push(command); assert.equal(command, 'grim'); assert.ok(args.includes('0,0 640x420')); callback(null, { stdout: Buffer.from(png(), 'base64') }); },
      decode: () => image,
    });
    c.context.mode = mode;
    c.context.selectMock = async (_kind, backdrop) => { calls.push('desktop'); assert.equal(Boolean(backdrop), mode === 'preserved'); return marked; };
    c.evaluate('settings.captureMode = mode; settings.countdownSeconds = 0; selectOnDesktop = selectMock; openLiveNote = async () => {};');
    await c.evaluate(`capture({ kind: '${kind}' })`);
    assert.ok(c.evaluate('frozen'), c.evaluate('lastNotice'));
    assert.equal(c.evaluate('frozen.size.width'), 640);
    assert.equal(c.evaluate('frozen.size.height'), 420);
    assert.equal(c.evaluate('frozen.kind'), kind);
    assert.deepEqual(calls, mode === 'preserved' ? ['snapshot', 'desktop', 'crop'] : [kind === 'rectangle' ? 'slurp' : 'desktop', 'grim']);
    assert.equal(c.submissions.length, 0);
  });
}
test('combined settings persist atomically, enforce limits, retain drafts and protect other senders', async () => {
  let saved;
  const c = controller({ saveSettings: (_file, value) => { saved = { ...value }; return value; } });
  assert.equal((await c.invoke('state')).settings.captureMode, 'live');
  assert.equal((await c.invoke('state')).settings.maxAnnotations, 8);
  await assert.rejects(c.invoke('settings', [{ countdownSeconds: 0 }]), /Only the Console/);
  await c.invoke('settings', [{ countdownSeconds: 3, captureMode: 'preserved', maxAnnotations: 2, defaultDeliverAs: 'steer' }], c.consoleWindow);
  assert.deepEqual(saved, { countdownSeconds: 3, captureMode: 'preserved', maxAnnotations: 2, defaultDeliverAs: 'steer' });
  const items = [0, 1].map(i => ({ id: 'old-' + i, image: png(), comment: 'Keep me' })); c.seed(undefined, items);
  await assert.rejects(c.invoke('settings', [{ maxAnnotations: 1 }], c.consoleWindow), /Finish the current capture/);
  await assert.rejects(c.invoke('add', [{ image: png(), comment: 'Over limit' }]), /Batch limit/);
  await c.invoke('cancel');
  await assert.rejects(c.invoke('settings', [{ maxAnnotations: 1 }], c.consoleWindow), /unsent annotations/);
  assert.equal(c.evaluate('drafts.length'), 2);
  const retake = controller(); retake.evaluate('settings.maxAnnotations = 2;'); retake.seed('old-0', items);
  assert.equal((await retake.invoke('add', [{ image: png(), comment: 'Allowed retake' }])).count, 2);
  retake.flush(); assert.equal(retake.evaluate('drafts[0].comment'), 'Allowed retake');
});
test('failed settings write keeps current settings and the batch', async () => {
  const c = controller({ saveSettings: () => { throw new Error('Disk unavailable'); } });
  await assert.rejects(c.invoke('settings', [{ captureMode: 'preserved' }], c.consoleWindow), /Disk unavailable/);
  assert.equal((await c.invoke('state')).settings.captureMode, 'live');
});
test('Send forwards both visible destination and mode; invalid modes keep drafts', async () => {
  const c = controller(); c.seed(); await c.invoke('add', [{ image: png(), comment: 'Ready' }]); c.flush();
  c.evaluate("routeState = { selected: { id: 'target' }, available: true }; settings.defaultDeliverAs = 'steer';");
  await assert.rejects(c.invoke('send', ['target', 'invalid'], c.consoleWindow), /Invalid delivery mode/);
  assert.equal(c.evaluate('drafts.length'), 1);
  await c.invoke('send', ['target'], c.consoleWindow);
  assert.equal(c.submissions[0].targetId, 'target'); assert.equal(c.submissions[0].deliverAs, 'steer');
});
