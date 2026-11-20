const { readFileSync, writeFileSync, mkdirSync, renameSync } = require('node:fs');
const { dirname } = require('node:path');
const MIN_SIZE = Object.freeze({ width: 320, height: 360 });
function consoleSize(value = {}, area = { width: 4000, height: 4000 }, minimum = MIN_SIZE) {
  const size = {};
  for (const [key, fallback, min] of [['width', 400, minimum.width], ['height', 600, minimum.height]]) {
    const n = Number.isFinite(value[key]) ? Math.round(value[key]) : fallback;
    size[key] = Math.min(area[key], Math.max(min, Math.min(4000, n)));
  }
  return size;
}
function loadSize(file, area) {
  try { return consoleSize(JSON.parse(readFileSync(file, 'utf8')), area); }
  catch { return consoleSize({}, area); }
}
function saveSize(file, size) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(consoleSize(size)), { mode: 0o600 });
  renameSync(temp, file);
}
function consoleBounds(value = {}, areas = [{ x: 0, y: 0, width: 4000, height: 4000 }], minimum = MIN_SIZE) {
  if (!value || typeof value !== 'object') value = {};
  areas = areas.filter(a => ['x', 'y', 'width', 'height'].every(k => Number.isFinite(a[k])) && a.width > 0 && a.height > 0);
  if (!areas.length) throw new Error('No display work area is available');
  const size = consoleSize(value, undefined, minimum);
  const positioned = Number.isFinite(value.x) && Number.isFinite(value.y);
  // Preserve intentional cross-monitor placement, but recover windows extending
  // beyond the remaining desktop after a monitor/resolution change.
  const withinDesktop = positioned && value.x >= Math.min(...areas.map(a => a.x)) && value.y >= Math.min(...areas.map(a => a.y)) && value.x + size.width <= Math.max(...areas.map(a => a.x + a.width)) && value.y + size.height <= Math.max(...areas.map(a => a.y + a.height));
  if (withinDesktop && areas.some(a => Math.min(value.x + size.width, a.x + a.width) - Math.max(value.x, a.x) >= Math.min(100, size.width) && value.y >= a.y && value.y + 24 <= a.y + a.height)) {
    return { ...size, x: Math.round(value.x), y: Math.round(value.y) };
  }
  const area = positioned ? areas.reduce((best, a) => {
    const distance = r => Math.hypot(value.x - (r.x + r.width / 2), value.y - (r.y + r.height / 2));
    return distance(a) < distance(best) ? a : best;
  }) : areas[0];
  const fitted = consoleSize(value, area, minimum);
  return { ...fitted, x: Math.round(area.x + (area.width - fitted.width) / 2), y: Math.round(area.y + (area.height - fitted.height) / 2) };
}
// `layout` records which Console design the stored bounds belong to.
function loadBounds(file, areas, minimum = MIN_SIZE) {
  let value; try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { value = {}; }
  const bounds = consoleBounds(value, areas, minimum);
  return typeof value?.layout === 'string' ? { ...bounds, layout: value.layout } : bounds;
}
function saveBounds(file, bounds, minimum = MIN_SIZE) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) throw new Error('Console position is unavailable');
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify({ ...consoleSize(bounds, undefined, minimum), x: Math.round(bounds.x), y: Math.round(bounds.y), ...(typeof bounds.layout === 'string' && { layout: bounds.layout }) }), { mode: 0o600 });
  renameSync(temp, file);
}
module.exports = { MIN_SIZE, consoleSize, loadSize, saveSize, consoleBounds, loadBounds, saveBounds };
