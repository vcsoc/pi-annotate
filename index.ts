import { spawn, type ChildProcess } from 'node:child_process';
import { ensureDependencies } from './dependencies.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createBridge } from './bridge.mjs';
import { deliverBatch } from './delivery.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export default function annotate(pi: ExtensionAPI) {
  let child: ChildProcess | undefined;
  let bridge: Awaited<ReturnType<typeof createBridge>> | undefined;
  let starting: Promise<void> | undefined;
  let current: ExtensionContext | undefined;
  let generation = 0;

  async function stop() {
    generation++;
    const process = child; child = undefined;
    if (process && process.exitCode === null) process.kill();
    const active = bridge; bridge = undefined;
    await active?.close();
    current?.ui.setStatus('annotate', undefined);
  }

  async function launch(ctx: ExtensionContext) {
    if (child && child.exitCode === null) { ctx.ui.notify('Annotate Console is already open. Use Capture or the global shortcut.', 'info'); return; }
    await stop();
    current = ctx;
    const epoch = generation;
    const executable = await ensureDependencies(root, { notify: (message: string) => ctx.ui.notify(message, 'info') });
    if (epoch !== generation) return;
    const cwd = ctx.cwd, session = ctx.sessionManager.getSessionId();
    const shortcut = process.env.PI_ANNOTATE_HOTKEY || 'CommandOrControl+Shift+A';
    bridge = await createBridge({
      project: cwd, session, shortcut,
      onStatus(message: string) { if (epoch === generation) ctx.ui.notify(`Annotate: ${message}`, 'info'); },
      async onSubmit(batch: any) {
        if (epoch !== generation) throw new Error('This Pi session has closed. Nothing was sent.');
        if (!current?.model?.input?.includes('image')) throw new Error('Select a vision-capable model in Pi, then retry Send. Your annotations are still in Annotate Console.');
        return deliverBatch(batch, {
          cwd, session,
          assertActive() { if (epoch !== generation) throw new Error('Session changed before delivery. Annotations were not sent.'); },
          send: (content: any, options: any) => pi.sendUserMessage(content, options),
        });
      }
    });
    if (epoch !== generation) { await bridge?.close(); bridge = undefined; return; }
    const activeBridge = bridge;
    const env = { ...process.env, PI_ANNOTATE_URL: bridge.url, PI_ANNOTATE_TOKEN: bridge.token };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [join(root, 'app', 'main.cjs')], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const launched = child;
    let errors = '';
    child.stderr?.on('data', chunk => { errors = (errors + chunk.toString()).slice(-3000); });
    child.once('error', error => { if (epoch === generation) ctx.ui.notify(`Annotate failed to launch: ${error.message}`, 'error'); });
    child.once('close', (code, signal) => {
      void activeBridge.close();
      if (child !== launched) return;
      child = undefined; bridge = undefined;
      ctx.ui.setStatus('annotate', undefined);
      if (code || signal) ctx.ui.notify(`Annotate Console exited (${signal || code}). ${errors.slice(-1000)}`, 'error');
    });
    ctx.ui.setStatus('annotate', 'annotate:open');
    ctx.ui.notify(`Opening Annotate Console. Capture → mark an app area → note → ✓ save. Global capture: ${shortcut}. Nothing is sent until Send.`, 'info');
  }

  pi.registerCommand('annotate', {
    description: 'Open Annotate Console: whole-app screenshots, highlighted areas, notes and batch Send',
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === 'help') return ctx.ui.notify('/annotate opens Annotate Console. Capture → mark an app area → enter the adjacent four-line note → ✓ save. Each image retains the entire application with your area highlighted. Select a saved entry to edit text, Retake / replace, or Retake as new. Send delivers the whole batch. /annotate stop discards unsent drafts.', 'info');
      if (action === 'stop') { await stop(); return; }
      if (action) return ctx.ui.notify('Usage: /annotate [help|stop]', 'warning');
      try { starting ??= launch(ctx).finally(() => { starting = undefined; }); await starting; }
      catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    }
  });
  pi.on('model_select', (_event, ctx) => { if (current) current = ctx; });
  pi.on('session_shutdown', stop);
}
