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
test('retake, reuse and remove act on the selected annotation shown in both designs', () => {
  assert.doesNotMatch(html, /id="(?:retake|retake-new|remove)"/);
  for (const id of ['entry-retake', 'entry-reuse', 'entry-remove']) assert.match(html, new RegExp(`id="${id}"[^>]*title=`));
  assert.match(js, /replaceId: item\.id/);
  assert.match(js, /copyId: item\.id/);
  assert.match(js, /api\.remove\(item\.id\)/);
});
test('double-click opens the annotation popup level with its entry; popup edits numbered marks', () => {
  assert.match(js, /addEventListener\('dblclick'/);
  assert.match(js, /api\.detailOpen\(id, Math\.round\(\(row \|\| event\.target\)\.getBoundingClientRect\(\)\.top\)\)/);
  for (const id of ['detail-prev', 'detail-next', 'detail-close', 'detail-canvas', 'mark-list', 'mark-rectangle', 'mark-freehand', 'detail-retake', 'detail-reuse', 'detail-remove', 'detail-done', 'entry-marks']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(js, /drawMarks\(c, marks/);
  assert.match(js, /api\.detailSave\(target, payload\)/);
});
test('live marking overlay can switch between Area and Freehand', () => {
  assert.match(html, /id="desktop-rectangle"/); assert.match(html, /id="desktop-freehand"/);
  assert.match(js, /api\.desktopKind\(tool\)/); assert.match(js, /api\.onDesktopKind\(showKind\)/);
});
test('both Console designs are styled: timeline feed panel and command pill bar with tray', () => {
  assert.match(html, /<section id="toolbar" class="layout-timeline"/);
  assert.match(css, /\.layout-timeline\{[^}]*grid-template-areas/);
  assert.match(css, /\.layout-pill\{[^}]*grid-template-areas/);
  assert.match(css, /\.layout-pill\.tray-open\{/);
});
test('overlay windows are transparent from their first paint (no full-screen flash on Capture)', () => {
  const early = readFileSync(new URL('../app/early.js', import.meta.url), 'utf8');
  // Classic script in <head>, before the stylesheet, so it runs before the first paint.
  assert.ok(html.indexOf('<script src="early.js"></script>') < html.indexOf('<link rel="stylesheet"'));
  assert.ok(html.indexOf('<script src="early.js"></script>') < html.indexOf('</head>'));
  const pages = page => /[?&]page=(?:desktop|mark)(?:&|$)/.test(`?page=${page}`);
  assert.match(early, /page=\(\?:desktop\|mark\)/);
  assert.deepEqual(['desktop', 'mark', 'toolbar', 'note', 'popup'].map(pages), [true, true, false, false, false]);
});
