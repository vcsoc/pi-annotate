import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureDependencies } from '../dependencies.mjs';
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'annotate-deps-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { electron: '44.4.3' } }));
  await writeFile(join(root, 'package-lock.json'), '{}');
  return root;
}
async function install(root) {
  const folder = join(root, 'node_modules/electron');
  await mkdir(join(folder, 'dist'), { recursive: true });
  await writeFile(join(folder, 'package.json'), JSON.stringify({ version: '44.4.3' }));
  await writeFile(join(folder, 'path.txt'), 'electron');
  await writeFile(join(folder, 'dist/electron'), 'fixture', { mode: 0o755 });
  return join(folder, 'dist/electron');
}
test('missing dependencies install once then skip setup on later launches', async t => {
  const root = await fixture(t), calls = [];
  const run = async (args, cwd) => { assert.equal(cwd, root); calls.push(args); if (args[0] === 'run') await install(root); };
  assert.equal(await ensureDependencies(root, { run }), join(root, 'node_modules/electron/dist/electron'));
  assert.deepEqual(calls, [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'setup']]);
  await ensureDependencies(root, { run: () => assert.fail('must not install twice') });
});
test('installation failure is actionable and can be retried', async t => {
  const root = await fixture(t);
  await assert.rejects(ensureDependencies(root, { run: async () => { throw new Error('offline'); } }), /automatic setup failed: offline/);
  await assert.rejects(ensureDependencies(root, { run: async () => {} }), /still missing/);
});
test('explicit executable overrides are respected, not silently replaced', async t => {
  const root = await fixture(t), executable = await install(root);
  assert.equal(await ensureDependencies(root, { override: executable }), executable);
  await assert.rejects(ensureDependencies(root, { override: join(root, 'missing'), run: () => assert.fail() }), /Correct or unset/);
});
