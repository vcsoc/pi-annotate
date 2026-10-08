import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../app/renderer.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
test('project location is an accessible destination dropdown and Send includes its selected session', () => {
  assert.match(html, /<label[^>]*for="project"/);
  assert.match(html, /<select id="project"[^>]*aria-label="Annotation destination"/);
  assert.match(js, /api\.target\(id\)/);
  assert.match(js, /\$\('project'\)\.value = state\.destinationId/);
  assert.match(js, /changingTarget = true/);
  assert.match(js, /api\.send\(state\.destinationId, \$\('delivery-mode'\)\.value\)/);
  assert.match(html, /selected Pi session/);
});
test('note input fills spare vertical space and Tick is wider without an expanding footer', () => {
  assert.match(css, /#note-comment\{[^}]*flex:1;min-height:112px/);
  assert.match(css, /\.note-actions\{[^}]*flex:0 0 auto/);
  assert.match(css, /\.note-actions \.tick\{[^}]*min-width:56px/);
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
