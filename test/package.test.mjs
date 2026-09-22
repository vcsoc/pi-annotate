import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
test('standalone package registers only the Annotate entrypoint', () => {
  assert.equal(manifest.name, 'pi-annotate');
  assert.ok(manifest.keywords.includes('pi-package'));
  assert.deepEqual(manifest.pi.extensions, ['./index.ts']);
  assert.equal(manifest.repository.url, 'https://github.com/vcsoc/pi-annotate.git');
  assert.equal(manifest.peerDependenciesMeta['@earendil-works/pi-coding-agent'].optional, true);
});
test('standalone runtime assets and dependency lock match the package', () => {
  const lock = JSON.parse(readFileSync(new URL('package-lock.json', root), 'utf8'));
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].dependencies.electron, manifest.dependencies.electron);
  for (const file of ['index.ts', 'bridge.mjs', 'delivery.mjs', 'dependencies.mjs', 'app/main.cjs', 'app/index.html', 'app/preload.cjs', 'app/renderer.js', 'app/style.css', 'app/console-placement.cjs', 'app/hyprland-shortcut.cjs', 'app/native/windows-macos.js', 'app/native/windows-win32.ps1']) {
    assert.ok(existsSync(new URL(file, root)), `Missing standalone asset: ${file}`);
  }
});
