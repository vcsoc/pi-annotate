// Real desktop/compositor + real screenshots of separate synthetic app windows.
// Pointer marking uses the real desktop selector, including its preserved frame.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createBridge } from '../bridge.mjs';
import { assertLiveAllowed } from './live-guard.mjs';
assertLiveAllowed();
const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(import.meta.url);
const hypr = Boolean(process.env.WAYLAND_DISPLAY && /hyprland/i.test(process.env.XDG_CURRENT_DESKTOP || ''));
const hostHypr = Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
const monitors = hostHypr ? JSON.parse(execFileSync('hyprctl', ['-j', 'monitors'])) : [{ x: 0, y: 0 }];
const temp = await mkdtemp(join(tmpdir(), 'annotate-console-test-'));
let received, application, fixture;
const bridge = await createBridge({ project: '/annotation-console-test', session: 'test-only', shortcut: 'CommandOrControl+Shift+A', onSubmit: async batch => { received = batch; return { count: batch.items.length, savedTo: '/test-only' }; } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function pageFor(role) {
  for (let i = 0; i < 120; i++) {
    const page = application.windows().find(p => !p.isClosed() && p.url().includes(`page=${role}`));
    if (page) return page;
    await wait(100);
  }
  throw new Error(`No ${role} window; state=${JSON.stringify(await application.windows()[0]?.evaluate(() => window.annotate?.state()))}`);
}
async function checkConsole(page) {
  const metrics = await page.evaluate(() => ({ w: innerWidth, h: innerHeight, root: document.body.getBoundingClientRect().toJSON(), scrollW: document.body.scrollWidth, scrollH: document.body.scrollHeight }));
  assert.ok(Math.abs(metrics.root.width - metrics.w) < 1); assert.ok(Math.abs(metrics.root.height - metrics.h) < 1);
  assert.ok(Math.abs(metrics.scrollW - metrics.w) <= 1); assert.ok(Math.abs(metrics.scrollH - metrics.h) <= 1);
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Annotate Console').getBounds());
  assert.ok(bounds.width <= 800 && bounds.height <= 400);
  if (hostHypr) {
    let client;
    for (let i = 0; i < 40; i++) {
      client = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'])).find(c => c.pid === application.process().pid && c.title === 'Annotate Console' && c.mapped);
      if (client?.floating && client.size[0] <= 800 && client.size[1] <= 400) break;
      await wait(100);
    }
    assert.ok(client?.floating && client.size[0] <= 800 && client.size[1] <= 400, `real Console must float within 800x400: ${JSON.stringify({ client, bounds, metrics })}`);
    const paint = await application.evaluate(async ({ BrowserWindow }) => {
      const image = await BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Annotate Console').capturePage();
      const size = image.getSize(), pixels = image.toBitmap();
      return { ...size, alpha: [0, (Math.floor(size.height / 2) * size.width + size.width - 1) * 4, (size.height * size.width - 1) * 4].map(offset => pixels[offset + 3]) };
    });
    assert.ok(Math.abs(paint.width - client.size[0]) <= 1 && Math.abs(paint.height - client.size[1]) <= 1, `paint must fill compositor bounds, without the reported blank strip: ${JSON.stringify({ paint, size: client.size })}`);
    assert.deepEqual(paint.alpha, [255, 255, 255], 'the Console must paint all the way to its edges');
  }
}
async function artifact(page, name) {
  if (!process.env.ANNOTATE_TEST_ARTIFACTS) return;
  await mkdir(process.env.ANNOTATE_TEST_ARTIFACTS, { recursive: true });
  await page.screenshot({ path: join(process.env.ANNOTATE_TEST_ARTIFACTS, name) });
}
try {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const adapters = fileURLToPath(new URL('../app/capture-adapters.cjs', import.meta.url));
  const fixtureFile = join(temp, 'fixture.cjs');
  await writeFile(fixtureFile, `const {app,BrowserWindow}=require('electron');app.commandLine.appendSwitch('force-device-scale-factor','1');const {enforceFloating}=require(${JSON.stringify(adapters)});const wins=[];app.whenReady().then(()=>{for(const [i,m] of ${JSON.stringify(monitors)}.entries()){const title='Annotation Test App '+(i+1);const bounds={x:m.x+50,y:m.y+80,width:640,height:420};const w=new BrowserWindow({...bounds,frame:false,transparent:true,hasShadow:false,resizable:false,title,show:false});wins.push(w);w.on('page-title-updated',e=>e.preventDefault());w.once('ready-to-show',()=>{w.show();void enforceFloating(w,${JSON.stringify(hostHypr ? 'hyprland' : null)},process.pid,bounds)});w.loadURL('data:text/html,'+encodeURIComponent('<title>'+title+'</title><body style="margin:0;background:#224466;color:white;font:20px sans-serif"><header style="padding:20px">'+title+' — whole application context</header><div style="position:absolute;left:100px;top:120px;width:180px;height:110px;background:#eab308;color:black">Marked control</div><footer style="position:absolute;bottom:20px;right:20px">Context outside the mark must remain</footer></body>'));}});app.on('window-all-closed',()=>app.quit());`);
  fixture = await _electron.launch({ executablePath: require('electron'), args: [fixtureFile], env });
  await fixture.firstWindow(); await wait(1800);
  let targets;
  if (hostHypr) targets = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'])).filter(c => c.pid === fixture.process().pid).sort((a, b) => a.title.localeCompare(b.title)).map(c => ({ x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1], title: c.title }));
  else targets = await fixture.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ ...w.getBounds(), title: w.getTitle() })).sort((a, b) => a.title.localeCompare(b.title)));
  assert.equal(targets.length, monitors.length);
  application = await _electron.launch({ executablePath: require('electron'), args: [fileURLToPath(new URL('../app/main.cjs', import.meta.url))], env: { ...env, PI_ANNOTATE_URL: bridge.url, PI_ANNOTATE_TOKEN: bridge.token }, timeout: 20000 });
  application.on('window', page => page.setDefaultTimeout(10000));
  const consolePage = await application.firstWindow(); consolePage.setDefaultTimeout(10000);
  await consolePage.locator('#project').filter({ hasText: '/annotation-console-test' }).waitFor(); await checkConsole(consolePage);
  const state = () => consolePage.evaluate(() => window.annotate.state());
  async function begin(button, targetIndex = 0) {
    const target = targets[targetIndex];
    await consolePage.locator(button).click();
    let page;
    {
      await pageFor('desktop');
      let picker, bounds;
      for (let attempt = 0; attempt < 50 && !picker; attempt++) {
        for (const candidate of application.windows().filter(p => p.url().includes('page=desktop'))) {
          const config = await candidate.evaluate(() => window.annotate.desktopConfig());
          if (hypr) assert.ok(config.background?.startsWith('data:image/png;base64,'), 'Hyprland selection must show the pre-focus frame');
          const b = config.bounds;
          if (target.x + 100 >= b.x && target.x + 280 < b.x + b.width && target.y + 120 >= b.y && target.y + 230 < b.y + b.height) { picker = candidate; bounds = b; break; }
        }
        if (!picker) await wait(100);
      }
      assert.ok(picker, 'desktop overlays must cover the target app without an app picker/editor');
      await picker.locator('#desktop-canvas').waitFor();
      await picker.mouse.move(target.x + 100 - bounds.x, target.y + 120 - bounds.y); await picker.mouse.down();
      await picker.mouse.move(target.x + 280 - bounds.x, target.y + 230 - bounds.y, { steps: 8 }); await picker.mouse.up();
      page = await pageFor('note');
    }
    await page.locator('#note-comment').waitFor();
    assert.equal(await page.locator('#note-comment').getAttribute('rows'), '5');
    const frozen = await page.evaluate(() => window.annotate.frozen());
    if (hypr) { assert.equal(frozen.size.width, target.width); assert.equal(frozen.size.height, target.height); }
    else assert.ok(Math.abs(frozen.size.width / frozen.size.height - target.width / target.height) < .03, 'Retina/HiDPI captures retain whole-app aspect ratio, not DIP pixel dimensions');
    assert.ok(frozen.size.width > 180 * 2 && frozen.size.height > 110 * 2, 'the capture must be the whole app, NOT the mark');
    if (hypr) {
      let note;
      for (let i = 0; i < 40; i++) {
        note = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'])).find(c => c.pid === application.process().pid && c.title === 'Annotate Note' && c.mapped);
        if (note && Math.abs(note.at[0] - frozen.noteBounds.x) < 2 && Math.abs(note.at[1] - frozen.noteBounds.y) < 2) break;
        await wait(100);
      }
      assert.ok(note?.floating); assert.deepEqual(note.at, [frozen.noteBounds.x, frozen.noteBounds.y], 'note must be placed beside the mark on its monitor');
    } else {
      const box = await page.locator('#note').boundingBox(); assert.ok(box.width <= 340 && box.height <= 246);
      assert.ok(frozen.noteBounds, 'native platforms must use the adjacent desktop note');
    }
    return { page, frozen };
  }
  async function save(page, comment, count) {
    await page.locator('#note-comment').fill(comment); await page.locator('#save-note').click();
    await consolePage.locator('.entry').nth(count - 1).waitFor();
    for (let i = 0; i < 30 && (await state()).capturing; i++) await wait(100);
    assert.equal((await state()).drafts.length, count); assert.equal(received, undefined, 'Tick must not send to Pi');
  }
  const originals = [];
  for (let i = 0; i < targets.length; i++) {
    const { page, frozen } = await begin('#capture', i); originals.push(frozen);
    await page.locator('#note-comment').fill(`Change marked control on app ${i + 1}`);
    if (!i) await artifact(page, 'note.png');
    await save(page, `Change marked control on app ${i + 1}`, i + 1);
  }
  await checkConsole(consolePage);
  const initial = await state(); const firstId = initial.drafts[0].id;
  await consolePage.locator('.entry').first().click();
  await consolePage.locator('#entry-comment').fill('Edited annotation text, same image');
  assert.equal((await state()).drafts[0].comment, 'Edited annotation text, same image');
  const oldPreview = (await state()).drafts[0].preview;
  let retake = await begin('#retake');
  assert.equal(await retake.page.locator('#note-comment').inputValue(), 'Edited annotation text, same image');
  await retake.page.locator('#cancel-note').click();
  await consolePage.locator('#notice').filter({ hasText: 'Existing annotations were kept' }).waitFor();
  assert.equal((await state()).drafts[0].preview, oldPreview); assert.equal((await state()).drafts[0].id, firstId);
  retake = await begin('#retake'); await save(retake.page, 'Replaced screenshot and note', targets.length);
  assert.equal((await state()).drafts[0].id, firstId); assert.equal((await state()).drafts[0].comment, 'Replaced screenshot and note');
  const appended = await begin('#retake-new'); await save(appended.page, 'Additional annotation', targets.length + 1);
  assert.notEqual((await state()).drafts.at(-1).id, firstId);
  await consolePage.locator('.entry').first().click();
  await artifact(consolePage, 'console.png');
  consolePage.on('dialog', () => assert.fail('Send must not open a confirmation dialog'));
  const closed = application.waitForEvent('close');
  await consolePage.locator('#send').click(); await closed;
  assert.equal(received.items.length, targets.length + 1); assert.equal(received.items[0].comment, 'Replaced screenshot and note');
  for (const [i, item] of received.items.entries()) {
    const original = i < targets.length ? (i === 0 ? retake.frozen : originals[i]) : appended.frozen;
    assert.equal(item.width, original.size.width); assert.equal(item.height, original.size.height);
    const pixels = await fixture.evaluate(({ nativeImage }, { before, after, points }) => {
      const a = nativeImage.createFromDataURL(before), b = nativeImage.createFromBuffer(Buffer.from(after, 'base64'));
      const width = a.getSize().width, height = a.getSize().height, pa = a.toBitmap(), pb = b.toBitmap();
      const sample = (bitmap, x, y) => [...bitmap.subarray((Math.floor(y * height) * width + Math.floor(x * width)) * 4, (Math.floor(y * height) * width + Math.floor(x * width)) * 4 + 4)];
      return { outsideA: sample(pa, .85, .8), outsideB: sample(pb, .85, .8), insideA: sample(pa, (points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2), insideB: sample(pb, (points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2) };
    }, { before: original.image, after: item.image, points: item.points });
    assert.deepEqual(pixels.outsideA, pixels.outsideB, 'surrounding full-app pixels must remain unchanged');
    assert.notDeepEqual(pixels.insideA, pixels.insideB, 'the marked area must actually be highlighted in the SAME image');
  }
  assert.equal(consolePage.isClosed(), true, 'successful Send must close the Console');
  console.log(`PASS: correctly sized floating Console; full-app + mark pixel verification on ${targets.length} app(s); adjacent 4-line note + Tick; list/edit; cancelled retake retention; replace identity; append; explicit batch Send (${hypr ? 'Hyprland/grim' : 'native desktop marking'})`);
} finally {
  await Promise.allSettled([application?.close(), fixture?.close(), bridge.close()]);
  await rm(temp, { recursive: true, force: true });
}
