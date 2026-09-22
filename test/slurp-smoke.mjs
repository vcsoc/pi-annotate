// Hyprland live selector test. Opens real slurp over every output, then Esc cancels.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createBridge } from '../bridge.mjs';
import { assertLiveAllowed } from './live-guard.mjs';
assertLiveAllowed();
const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(import.meta.url);
if (!/hyprland/i.test(process.env.XDG_CURRENT_DESKTOP || '')) throw new Error('This smoke test requires Hyprland');
const monitors = JSON.parse(execFileSync('hyprctl', ['-j', 'monitors']));
const bridge = await createBridge({ project: '/selector-test', session: 'selector-test', shortcut: 'CommandOrControl+Shift+A', onSubmit: () => assert.fail('No sends permitted') });
let application;
try {
  const env = { ...process.env, PI_ANNOTATE_URL: bridge.url, PI_ANNOTATE_TOKEN: bridge.token }; delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: require('electron'), args: [fileURLToPath(new URL('../app/main.cjs', import.meta.url))], env });
  const toolbar = await application.firstWindow();
  await toolbar.locator('#project').filter({ hasText: '/selector-test' }).waitFor();
  await new Promise(r => setTimeout(r, 700));
  await toolbar.locator('#capture').click();
  let coversAll = false;
  for (let i = 0; i < 40; i++) {
    const layers = JSON.parse(execFileSync('hyprctl', ['-j', 'layers']));
    coversAll = monitors.every(m => Object.values(layers[m.name]?.levels || {}).flat().some(l => l.namespace === 'selection' && l.x === m.x && l.y === m.y && l.w > 0 && l.h > 0));
    if (coversAll) break;
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(coversAll, true, 'native region selector must cover every monitor, including negative origins');
  execFileSync('wtype', ['-k', 'Escape']);
  await toolbar.locator('#notice').filter({ hasText: 'Capture cancelled' }).waitFor();
  assert.equal((await toolbar.evaluate(() => window.annotate.state())).drafts.length, 0);
  assert.equal(application.windows().length, 1, 'Cancel must not silently fall back to capturing primary');
  console.log(`PASS: real selector covers all ${monitors.length} monitors; Esc returns without any capture/fallback`);
} finally { await Promise.allSettled([application?.close(), bridge.close()]); }
