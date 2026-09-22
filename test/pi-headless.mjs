// Real Pi registration/help check. Never runs /annotate, opens Electron, or calls a model.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
// Defaults to testing the package manifest, not merely importing index.ts.
// Installed-mode is for an isolated PI_CODING_AGENT_DIR with this Git package.
const extensionArgs = process.env.ANNOTATE_TEST_INSTALLED === '1' ? [] : ['--no-extensions', '-e', fileURLToPath(new URL('../', import.meta.url))];
const child = spawn(process.env.PI_BIN || 'pi', ['--mode', 'rpc', '--no-session', '--no-skills', '--no-prompt-templates', '--no-context-files', ...extensionArgs], { stdio: ['pipe', 'pipe', 'pipe'] });
const events = []; let buffer = '', errors = '', spawnError;
child.on('error', error => { spawnError = error; });
child.stdout.on('data', chunk => {
  buffer += chunk; let index;
  while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); try { events.push(JSON.parse(line)); } catch {} }
});
child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
child.stdin.on('error', () => {});
async function wait(predicate) {
  for (let i = 0; i < 300; i++) {
    if (spawnError) throw spawnError;
    const event = events.find(predicate); if (event) return event;
    if (child.exitCode !== null) throw new Error(`Pi exited before response: ${errors}`);
    await sleep(50);
  }
  throw new Error(`Pi headless check timed out: ${errors}`);
}
const send = message => child.stdin.write(JSON.stringify(message) + '\n');
try {
  send({ id: 'commands', type: 'get_commands' });
  const response = await wait(e => e.id === 'commands');
  const commands = response.data.commands.filter(c => c.name === 'annotate');
  assert.equal(commands.length, 1, 'The package must register exactly one /annotate command');
  assert.ok(commands[0].description.includes('Annotate Console'));
  send({ id: 'help', type: 'prompt', message: '/annotate help' });
  assert.equal((await wait(e => e.id === 'help')).success, true);
  await wait(e => e.type === 'extension_ui_request' && e.method === 'notify' && /entire application/.test(e.message) && /Retake/.test(e.message));
  assert.ok(!events.some(e => e.type === 'extension_error' || e.type === 'agent_start'));
  console.log('PASS: actual Pi discovers exactly one /annotate command from the package and runs help without Electron or a model call');
} finally {
  if (child.exitCode === null && !spawnError) {
    child.kill('SIGTERM');
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(2000)]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
}
