import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ensureDependencies } from './dependencies.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
// Use a fresh module identity: older Pi processes can retain bridge.mjs across /reload.
import { createBridge } from './session-bridge.mjs';
import { deliverBatch } from './delivery.mjs';
import { advertise, activeTargets, createRouting, request } from './targets.mjs';

const root = dirname(fileURLToPath(import.meta.url));

export default function annotate(pi: ExtensionAPI) {
  let child: ChildProcess | undefined;
  let bridge: Awaited<ReturnType<typeof createBridge>> | undefined;
  let starting: Promise<void> | undefined, registering: Promise<void> | undefined;
  let current: ExtensionContext | undefined;
  let record: any, routing: ReturnType<typeof createRouting>, withdraw: (() => void) | undefined;
  let generation = 0, launchGeneration = 0;
  const id = randomUUID();
  const open = () => Boolean(child && child.exitCode === null && !child.killed);

  function stopChild() {
    launchGeneration++;
    const process = child; child = undefined;
    if (process && process.exitCode === null) process.kill();
    current?.ui.setStatus('annotate', undefined);
  }
  async function shutdown() {
    generation++; stopChild();
    const remove = withdraw; withdraw = undefined;
    const active = bridge; bridge = undefined;
    try { remove?.(); } finally { await active?.close(); }
  }
  async function ensureBridge(ctx: ExtensionContext) {
    current = ctx;
    if (bridge) return;
    registering ??= (async () => {
      const epoch = generation, cwd = ctx.cwd, session = ctx.sessionManager.getSessionId();
      const assertActive = () => { if (epoch !== generation) throw new Error('This Pi session has closed. Nothing was sent.'); };
      const submit = async (batch: any) => {
        assertActive();
        if (!current?.model?.input?.includes('image')) throw new Error('Select a vision-capable model in the destination Pi session, then retry Send. Annotations remain in the Console.');
        return deliverBatch(batch, { cwd, session, assertActive, send: (content: any, options: any) => pi.sendUserMessage(content, options) });
      };
      const active = await createBridge({
        project: cwd, session, shortcut: process.env.PI_ANNOTATE_HOTKEY || 'CommandOrControl+Shift+A',
        getInfo: () => ({ targetId: id, name: pi.getSessionName?.() || '', consoleOpen: open() }),
        onStatus(message: string) { if (epoch === generation) current?.ui.notify(`Annotate: ${message}`, 'info'); },
        onSubmit: submit,
        onRouteSubmit: (batch: any, targetId: string) => { assertActive(); return routing.submit(batch, targetId); },
        onTargets: () => routing.targets(),
        onSelectTarget: (targetId: string) => { assertActive(); return routing.select(targetId); },
        onStop: () => { stopChild(); return { ok: true }; },
      });
      if (epoch !== generation) { await active.close(); throw new Error('Pi session changed during Annotate registration'); }
      record = { id, project: cwd, session, url: active.url, token: active.token };
      routing = createRouting(record, { localSubmit: submit });
      try {
        const status = await request(record, '/session');
        assertActive();
        if (status.targetId !== id || status.project !== cwd || status.session !== session) {
          throw new Error('Annotate loaded an outdated bridge module. Fully restart Pi and resume this session to refresh cached modules.');
        }
        withdraw = advertise(record); bridge = active;
      } catch (error) { await active.close(); throw error; }
    })().finally(() => { registering = undefined; });
    await registering;
  }

  async function launch(ctx: ExtensionContext) {
    const epoch = generation, launchEpoch = launchGeneration;
    await ensureBridge(ctx);
    const existing = open() ? record : (await activeTargets()).find(target => target.consoleOpen);
    if (epoch !== generation || launchEpoch !== launchGeneration) return;
    if (existing) {
      await request(existing, '/target', { id }, 5000);
      ctx.ui.notify(`Annotate Console now sends to ${ctx.cwd} (this Pi session). Existing annotations were kept.`, 'info');
      return;
    }
    await routing.select(id);
    const executable = await ensureDependencies(root, { notify: (message: string) => ctx.ui.notify(message, 'info') });
    if (epoch !== generation || launchEpoch !== launchGeneration) return;
    const env = { ...process.env, PI_ANNOTATE_URL: bridge!.url, PI_ANNOTATE_TOKEN: bridge!.token };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, [join(root, 'app', 'main.cjs')], { env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
    const launched = child;
    let errors = '';
    child.stderr?.on('data', chunk => { errors = (errors + chunk.toString()).slice(-3000); });
    child.once('error', error => { if (epoch === generation) ctx.ui.notify(`Annotate failed to launch: ${error.message}`, 'error'); });
    child.once('close', (code, signal) => {
      if (child !== launched) return;
      child = undefined;
      ctx.ui.setStatus('annotate', undefined);
      if (code || signal) ctx.ui.notify(`Annotate Console exited (${signal || code}). ${errors.slice(-1000)}`, 'error');
    });
    ctx.ui.setStatus('annotate', 'annotate:open');
    ctx.ui.notify('Opening Annotate Console. Choose a project/session destination; nothing is sent until Send.', 'info');
  }

  pi.registerCommand('annotate', {
    description: 'Open Annotate Console: whole-app screenshots, highlighted areas, notes and batch Send',
    handler: async (args, ctx) => {
      const action = args.trim().toLowerCase();
      if (action === 'help') return ctx.ui.notify('/annotate opens or retargets the existing Console to this project/session, keeping drafts. Capture → mark an app area → note → ✓ save. Each image retains the entire application with your area highlighted. Retake / replace or Retake as new. Select an active Pi destination before Send. /annotate stop discards unsent drafts.', 'info');
      if (action && action !== 'stop') return ctx.ui.notify('Usage: /annotate [help|stop]', 'warning');
      try {
        if (action === 'stop') {
          launchGeneration++;
          const existing = (await activeTargets()).find(target => target.consoleOpen);
          if (existing) await request(existing, '/stop', {}, 5000);
          return;
        }
        starting ??= launch(ctx).finally(() => { starting = undefined; }); await starting;
      } catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error'); }
    }
  });
  // Register only live sessions, not folders from historic transcripts. Each
  // destination owns its own delivery API, cwd, model check and session lifetime.
  pi.on('session_start', async (_event, ctx) => {
    if (!ctx.hasUI) return;
    try { await ensureBridge(ctx); }
    catch (error) { ctx.ui.notify(`Annotate destination registration failed: ${error instanceof Error ? error.message : error}`, 'warning'); }
  });
  pi.on('model_select', (_event, ctx) => { if (current) current = ctx; });
  pi.on('session_shutdown', shutdown);
}
