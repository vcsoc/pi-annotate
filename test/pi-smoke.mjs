// Requires Pi and a graphical desktop. No provider requests are made.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertLiveAllowed } from './live-guard.mjs';
assertLiveAllowed();
const child = spawn(process.env.PI_BIN || 'pi', ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-context-files', '-e', fileURLToPath(new URL('../index.ts', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
const events = []; let buffer = '', errors = '';
child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { events.push(JSON.parse(line)); } catch {} } });
child.stderr.on('data', chunk => errors += chunk);
const send = (id, type, extra = {}) => child.stdin.write(JSON.stringify({ id, type, ...extra }) + '\n');
async function wait(predicate, ms = 20000) { const deadline = Date.now() + ms; while (Date.now() < deadline) { const value = events.find(predicate); if (value) return value; await sleep(50); } throw new Error(`Timeout: ${JSON.stringify(events)} ${errors}`); }
try {
  send('commands', 'get_commands');
  const commands = await wait(e => e.id === 'commands');
  assert.ok(commands.data.commands.some(c => c.name === 'annotate'));
  send('help', 'prompt', { message: '/annotate help' });
  assert.equal((await wait(e => e.id === 'help')).success, true);
  send('start', 'prompt', { message: '/annotate' });
  await wait(e => e.type === 'extension_ui_request' && e.method === 'notify' && /Annotate: Annotate Console ready/.test(e.message));
  assert.equal((await wait(e => e.id === 'start')).success, true);
  send('stop', 'prompt', { message: '/annotate stop' });
  assert.equal((await wait(e => e.id === 'stop')).success, true);
  assert.ok(!events.some(e => e.type === 'extension_error'));
  assert.ok(!events.some(e => e.type === 'agent_start'), 'smoke test must not call a provider');
  console.log('PASS: real Pi discovers /annotate, help, launches authenticated companion, and stops cleanly without a model call');
} finally { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(3000)]); if (child.exitCode === null) child.kill('SIGKILL'); }
