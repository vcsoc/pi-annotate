'use strict';
// Edge docking for the Console. Dropping the window within SNAP_THRESHOLD px of
// a screen's left/right work-area edge docks it there as a full-height panel,
// separated from the screen edges by SNAP_GAP px. Pure geometry; no Electron.
const SNAP_GAP = 6, SNAP_THRESHOLD = 32;
const valid = r => r && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(r[k])) && r.width > 0 && r.height > 0;
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Work area the window belongs to: the one containing its centre, else the most overlapped. */
function areaFor(bounds, areas) {
  const usable = (areas || []).filter(valid);
  if (!valid(bounds) || !usable.length) return;
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  return usable.find(a => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) ||
    usable.reduce((best, a) => overlap(bounds, a) > overlap(bounds, best) ? a : best);
}

/**
 * Docked bounds for a window released near a side edge, or undefined when it
 * is not near one. A window pushed past the edge counts as near it.
 */
function dockBounds(bounds, areas, { gap = SNAP_GAP, threshold = SNAP_THRESHOLD } = {}) {
  const area = areaFor(bounds, areas);
  if (!area) return;
  const left = bounds.x - area.x, right = area.x + area.width - (bounds.x + bounds.width);
  const side = left <= threshold && left <= right ? 'left' : right <= threshold ? 'right' : undefined;
  if (!side) return;
  const width = Math.round(Math.min(bounds.width, area.width - 2 * gap)), height = Math.round(area.height - 2 * gap);
  const x = Math.round(side === 'left' ? area.x + gap : area.x + area.width - gap - width);
  return { side, x, y: Math.round(area.y + gap), width, height };
}

/** Bounds for a docked window dragged away from the edge: restore its pre-dock height. */
function undockBounds(bounds, areas, height) {
  const area = areaFor(bounds, areas);
  if (!area || !Number.isFinite(height)) return;
  const h = Math.round(Math.min(height, area.height));
  const y = Math.round(Math.min(Math.max(bounds.y, area.y), area.y + area.height - h));
  return { x: Math.round(bounds.x), y, width: Math.round(bounds.width), height: h };
}

const same = (a, b) => ['x', 'y', 'width', 'height'].every(k => Math.abs(a[k] - b[k]) <= 1);
module.exports = { SNAP_GAP, SNAP_THRESHOLD, areaFor, dockBounds, undockBounds, same };
