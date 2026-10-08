// Hyprland live preserved-selector test (legacy script name). Esc cancels.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createBridge } from '../bridge.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertLiveAllowed } from './live-guard.mjs';
assertLiveAllowed();
const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(import.meta.url);
if (!/hyprland/i.test(process.env.XDG_CURRENT_DESKTOP || '')) throw new Error('This smoke test requires Hyprland');
const monitors = JSON.parse(execFileSync('hyprctl', ['-j', 'monitors']));
const bridge = await createBridge({ project: '/selector-test', session: 'selector-test', shortcut: 'CommandOrControl+Shift+A', onSubmit: () => assert.fail('No sends permitted') });
let application;
const temp = await mkdtemp(join(tmpdir(), 'annotate-preserved-selector-'));
try {
  const userData = join(temp, 'companion-data'), companionFile = join(temp, 'companion.cjs');
  await mkdir(userData, { mode: 0o700 });
  await writeFile(join(userData, 'settings.json'), JSON.stringify({ countdownSeconds: 0, captureMode: 'preserved' }));
  await writeFile(companionFile, `require('electron').app.setPath('userData', ${JSON.stringify(userData)});require(${JSON.stringify(fileURLToPath(new URL('../app/main.cjs', import.meta.url)))});`);
  const env = { ...process.env, PI_ANNOTATE_URL: bridge.url, PI_ANNOTATE_TOKEN: bridge.token }; delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: require('electron'), args: [companionFile], env });
  const toolbar = await application.firstWindow();
  await toolbar.locator('#project').waitFor();
  assert.equal((await toolbar.evaluate(() => window.annotate.state())).project, '/selector-test');
  await new Promise(r => setTimeout(r, 700));
  await toolbar.locator('#capture').click();
  let coversAll = false;
  for (let i = 0; i < 120; i++) {
    const clients = JSON.parse(execFileSync('hyprctl', ['-j', 'clients'])).filter(c => c.pid === application.process().pid && c.mapped && c.title.startsWith('Annotate Capture — display'));
    coversAll = monitors.filter(m => !m.disabled).every(m => clients.some(c => c.at[0] === m.x && c.at[1] === m.y && c.size[0] > 0 && c.size[1] > 0));
    if (coversAll) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(coversAll, true, 'preserved-frame selector must cover every monitor, including negative origins');
  for (const page of application.windows().filter(p => p.url().includes('page=desktop'))) {
    assert.ok((await page.evaluate(() => window.annotate.desktopConfig())).background.startsWith('data:image/png;base64,'));
  }
  execFileSync('wtype', ['-k', 'Escape']);
  await toolbar.locator('#notice').filter({ hasText: 'Capture cancelled' }).waitFor();
  assert.equal((await toolbar.evaluate(() => window.annotate.state())).drafts.length, 0);
  assert.equal(application.windows().length, 1, 'Cancel must not silently fall back to capturing primary');
  console.log(`PASS: real selector covers all ${monitors.length} monitors; Esc returns without any capture/fallback`);
} finally { await Promise.allSettled([application?.close(), bridge.close()]); await rm(temp, { recursive: true, force: true }); }
