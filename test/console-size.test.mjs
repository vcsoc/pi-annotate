import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { consoleSize, loadSize, saveSize } = createRequire(import.meta.url)('../app/console-size.cjs');
test('Console defaults to 400x600 and clamps to available screen', () => {
  assert.deepEqual(consoleSize(), { width: 400, height: 600 });
  assert.deepEqual(consoleSize({ width: NaN, height: -100 }), { width: 400, height: 360 });
  assert.deepEqual(consoleSize({ width: 1000, height: 900 }, { width: 800, height: 700 }), { width: 800, height: 700 });
});
test('Console resize persists across launches and missing preferences use defaults', () => {
  const root = mkdtempSync(join(tmpdir(), 'annotate-size-')), file = join(root, 'size.json');
  try {
    assert.deepEqual(loadSize(file), { width: 400, height: 600 });
    saveSize(file, { width: 550, height: 750 });
    assert.deepEqual(loadSize(file), { width: 550, height: 750 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('capture screenshots only after selection and uses selected native macOS window', () => {
  const source = readFileSync(new URL('../app/main.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /focusedSources|preserveFocus/);
  const selection = source.indexOf('const marked = await selectOnDesktop(kind)');
  assert.ok(source.indexOf('await captureMacWindow(target.nativeId') > selection);
  assert.ok(source.indexOf("thumbnailSize: { width: 1920, height: 1920 }") > selection);
  assert.match(source, /if \(process.platform !== 'darwin'\) await delay\(350\)/);
});
