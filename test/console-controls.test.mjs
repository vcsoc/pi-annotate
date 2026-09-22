import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
test('project path has a separate wrapping, selectable location row', () => {
  assert.match(html, /class="project-location"/);
  assert.match(css, /\.project-location #project\{[^}]*white-space:normal;overflow-wrap:anywhere/);
});
test('global icon actions have tooltips and preserve the send count', () => {
  assert.match(html, /id="clear"[^>]*title="Discard all annotations"[^>]*aria-label=/);
  assert.match(html, /id="send-count"/);
  assert.match(js, /\$\('send-count'\)\.textContent = String\(state\.drafts\.length\)/);
  assert.doesNotMatch(js, /\$\('send'\)\.textContent/);
});
test('retake and remove controls belong to each draft, not bottom detail panel', () => {
  assert.doesNotMatch(html, /id="(?:retake|retake-new|remove)"/);
  assert.match(js, /replaceId: item\.id/);
  assert.match(js, /copyId: item\.id/);
  assert.match(js, /api\.remove\(item\.id\)/);
  assert.match(js, /row\.append\(button, controls\)/);
  assert.match(js, /control\.setAttribute\('aria-label', label\)/);
});
