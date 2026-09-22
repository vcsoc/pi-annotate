'use strict';
const { execFile, fork } = require('node:child_process');
const { promisify } = require('node:util');
const { createServer } = require('node:http');
const { createHash, randomBytes } = require('node:crypto');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const exec = promisify(execFile);
const runCommand = (command, args) => exec(command, args, { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function accelerator(value) {
  const parts = String(value).split('+').map(p => p.trim());
  const input = parts.pop();
  const aliases = { ctrl: ['CTRL', 4], control: ['CTRL', 4], commandorcontrol: ['CTRL', 4], shift: ['SHIFT', 1], alt: ['ALT', 8], super: ['SUPER', 64], meta: ['SUPER', 64] };
  const modifiers = new Map();
  for (const part of parts) {
    const modifier = aliases[part.toLowerCase()];
    if (!modifier) throw new Error(`Unsupported shortcut modifier: ${part}`);
    modifiers.set(...modifier);
  }
  const named = { space: 'space', escape: 'Escape', enter: 'Return', tab: 'Tab', backspace: 'BackSpace', delete: 'Delete', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', left: 'Left', right: 'Right', up: 'Up', down: 'Down' };
  const key = /^[a-z0-9]$/i.test(input) || /^F(?:[1-9]|1\d|2[0-4])$/i.test(input) ? input.toUpperCase() : named[input?.toLowerCase()];
  if (!key || !modifiers.size) throw new Error('Use a modified letter, number, function key or named navigation key for the Annotate shortcut');
  const mods = [...modifiers.keys()].sort();
  return { key, mask: [...modifiers.values()].reduce((a, b) => a | b, 0), chord: [...mods, key].join(' + ') };
}
function matching(binds, spec) {
  return binds.filter(b => b.modmask === spec.mask && (String(b.key).toLowerCase() === spec.key.toLowerCase() || b.keycode > 0 || b.catch_all));
}
async function removeBinding(descriptor, run = runCommand) {
  const binds = JSON.parse((await run('hyprctl', ['-j', 'binds'])).stdout);
  const matches = matching(binds, descriptor);
  // Never remove a binding another app/user installed while we were running.
  if (matches.length && matches.every(b => b.description === descriptor.description)) {
    const result = await run('hyprctl', ['eval', `hl.unbind(${JSON.stringify(descriptor.chord)})`]);
    if (/error|unknown|invalid/i.test(result.stdout)) throw new Error('Could not release the temporary Annotate shortcut');
  }
}
async function cleanup(descriptor, run = runCommand) {
  try { await removeBinding(descriptor, run); }
  finally { rmSync(descriptor.directory, { recursive: true, force: true }); }
}
async function installShortcut(shortcut, capture, run = runCommand, failure = () => {}, pollMs = 2000) {
  const spec = accelerator(shortcut);
  const id = randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const directory = mkdtempSync(join(tmpdir(), 'pi-annotate-shortcut-'));
  const descriptor = { ...spec, directory, description: `Pi Annotate capture ${id}` };
  // An abstract Unix socket is also an atomic, crash-released ownership lock.
  // No listening TCP port, stale lock file, or PID-reuse-prone signal command.
  const identity = `${process.getuid?.()}:${process.env.HYPRLAND_INSTANCE_SIGNATURE}:${spec.chord}`;
  const socket = `pi-annotate-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
  const server = createServer((request, response) => {
    request.resume();
    if (request.method !== 'POST' || request.url !== '/capture' || request.headers['x-pi-annotate-shortcut'] !== secret) {
      response.writeHead(403); response.end(); return;
    }
    try { capture(); response.writeHead(204); response.end(); }
    catch { response.writeHead(503); response.end(); }
  });
  server.requestTimeout = 2000; server.headersTimeout = 2000;
  let bound = false, stopped = false, timer, checking, stoppingPromise;
  let pending = Promise.resolve();
  const stop = () => {
    if (stoppingPromise) return stoppingPromise;
    stopped = true; clearInterval(timer);
    return stoppingPromise = (async () => {
      try { await pending.catch(() => {}); if (bound) await removeBinding(descriptor, run); }
      finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      }
    })();
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen('\0' + socket, () => { server.removeListener('error', reject); resolve(); });
    });
    let existing = matching(JSON.parse((await run('hyprctl', ['-j', 'binds'])).stdout), spec);
    // Owning the exclusive socket proves no live helper owns this chord. Recover
    // a stale binding left if both Electron and its helper were forcibly killed.
    if (existing.length === 1 && /^Pi Annotate capture [a-f0-9]{32}$/.test(existing[0].description || '')) {
      await removeBinding({ ...spec, description: existing[0].description }, run);
      existing = matching(JSON.parse((await run('hyprctl', ['-j', 'binds'])).stdout), spec);
    }
    if (existing.length) throw new Error(`${shortcut} already has a desktop binding. Annotate will not replace it; choose PI_ANNOTATE_HOTKEY or close the other Console.`);
    await run('curl', ['--version']);
    const config = join(directory, 'trigger.conf');
    writeFileSync(config, `url = "http://localhost/capture"\nabstract-unix-socket = "${socket}"\nrequest = "POST"\nheader = "X-Pi-Annotate-Shortcut: ${secret}"\nproxy = ""\nnoproxy = "*"\nconnect-timeout = 1\nmax-time = 2\nsilent\noutput = "/dev/null"\n`, { mode: 0o600 });
    const command = `curl -q --config ${quote(config)}`;
    // Consuming compositor binding: focused apps never receive this keypress.
    // Honour the lock screen, but bypass ordinary app shortcut inhibitors.
    const inspect = async () => matching(JSON.parse((await run('hyprctl', ['-j', 'binds'])).stdout), spec);
    const verify = installed => {
      if (installed.length !== 1 || installed[0].description !== descriptor.description || installed[0].non_consuming || installed[0].auto_consuming) throw new Error('Could not verify exclusive Annotate shortcut ownership');
    };
    const bind = async () => {
      if (stopped) return;
      bound = true; // Clean up partially successful eval/verification as well.
      const result = await run('hyprctl', ['eval', `hl.bind(${JSON.stringify(spec.chord)},hl.dsp.exec_cmd(${JSON.stringify(command)}),{description=${JSON.stringify(descriptor.description)},non_consuming=false,auto_consuming=false,dont_inhibit=true,submap_universal=true})`]);
      if (/error|unknown|invalid/i.test(result.stdout)) throw new Error('Hyprland rejected the temporary shortcut binding (Lua API required)');
      verify(await inspect());
    };
    await bind();
    // A compositor config reload clears runtime binds. Restore ours only if the
    // chord is still free; otherwise report loss of ownership instead of lying
    // about readiness or overriding the user's new binding.
    timer = setInterval(() => {
      if (stopped || checking) return;
      checking = true;
      pending = (async () => {
        const installed = await inspect();
        if (stopped) return;
        if (!installed.length) await bind(); else verify(installed);
      })();
      void pending.then(() => { checking = false; }, error => {
        checking = false;
        void stop().catch(console.error);
        failure(error);
      });
    }, pollMs);
    timer.unref();
    return { descriptor, stop };
  } catch (error) {
    await stop().catch(() => {});
    if (error.code === 'EADDRINUSE') throw new Error(`Another Annotate Console owns ${shortcut}. Close it first or choose PI_ANNOTATE_HOTKEY.`);
    throw error;
  }
}

// The helper owns the binding and survives long enough to release it even when
// Electron exits/crashes. IPC disconnect is a kernel-managed lifetime signal.
async function runWorker(install = installShortcut) {
  let closing = false, lease;
  const close = async () => { closing = true; if (lease) await lease.stop(); };
  process.on('disconnect', () => { void close().catch(console.error); });
  process.on('SIGTERM', () => { void close().catch(console.error).finally(() => { if (process.connected) process.disconnect(); }); });
  try {
    lease = await install(process.argv[2], () => {
      if (closing || !process.connected) throw new Error('Console closed');
      process.send({ type: 'capture' }, () => {});
    }, undefined, error => {
      if (process.connected) process.send({ type: 'error', message: error.message }, () => { if (process.connected) process.disconnect(); });
    });
    if (closing || !process.connected) { await lease.stop(); return; }
    process.send({ type: 'ready', descriptor: lease.descriptor }, () => {});
  } catch (error) {
    if (process.connected) process.send({ type: 'error', message: error.message }, () => { if (process.connected) process.disconnect(); });
  }
}
function registerShortcut(shortcut, capture, failed) {
  return new Promise((resolve, reject) => {
    const child = fork(__filename, [shortcut], { execPath: process.execPath, execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', data => console.error('Annotate shortcut:', data.toString().trim()));
    let ready = false, stopping = false, descriptor;
    const timer = setTimeout(() => { stopping = true; if (child.connected) child.disconnect(); reject(new Error('Annotate desktop shortcut registration timed out')); }, 12000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('message', message => {
      if (message.type === 'capture' && ready && !stopping) capture();
      if (message.type === 'error') {
        clearTimeout(timer);
        const error = new Error(message.message);
        if (ready && !stopping) { stopping = true; failed(error); if (child.connected) child.disconnect(); }
        else reject(error);
      }
      if (message.type === 'ready') {
        descriptor = message.descriptor; clearTimeout(timer);
        if (stopping) { if (child.connected) child.disconnect(); return; }
        ready = true;
        resolve({ stop() { stopping = true; if (child.connected) child.disconnect(); } });
      }
    });
    child.on('exit', () => {
      clearTimeout(timer);
      if (!ready) reject(new Error('Annotate shortcut helper exited before registration'));
      if (ready && !stopping) {
        if (descriptor) void cleanup(descriptor).catch(console.error);
        failed(new Error('Annotate shortcut helper stopped. Restart /annotate to restore its shortcut.'));
      }
    });
  });
}
module.exports = { accelerator, matching, installShortcut, removeBinding, cleanup, runWorker, registerShortcut };
if (require.main === module) {
  if (!process.send) throw new Error('Shortcut helper requires an owning Console IPC connection');
  void runWorker();
}
