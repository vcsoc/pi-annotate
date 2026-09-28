import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectLabel } from '../app/project-label.mjs';

test('project label shows folder first, then parent path with trailing separator', () => {
  assert.equal(projectLabel('/home/vcsoc/Projects/inkwell'), 'inkwell : /home/vcsoc/Projects/');
  assert.equal(projectLabel('/home/vcsoc/Projects/inkwell/'), 'inkwell : /home/vcsoc/Projects/');
  assert.equal(projectLabel('C:\\Projects\\inkwell'), 'inkwell : C:\\Projects\\');
  assert.equal(projectLabel('\\\\server\\share\\inkwell'), 'inkwell : \\\\server\\share\\');
  assert.equal(projectLabel('/'), '/');
  assert.equal(projectLabel('C:\\'), 'C:\\');
  assert.equal(projectLabel('inkwell'), 'inkwell');
});
test('destination remains a native keyboard-accessible select with flat label styling', () => {
  const css = readFileSync(new URL('../app/style.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.match(html, /<select id="project"[^>]*aria-label=/);
  assert.match(css, /\.project-location #project\{[^}]*appearance:none[^}]*background:transparent;border:0;border-radius:0;cursor:pointer/);
  assert.match(css, /select:focus-visible\{outline:/);
});
