'use strict';
// Window geometry for the two Console designs and the annotation detail popup.
// Pure functions; no Electron.
const { SNAP_GAP, SNAP_THRESHOLD, areaFor } = require('./console-snap.cjs');
const LAYOUTS = Object.freeze(['timeline', 'pill']);
const TIMELINE_WIDTH = 320, TIMELINE_HEIGHT_RATIO = 0.6, TIMELINE_MIN = Object.freeze({ width: 280, height: 360 });
const PILL_SIZES = Object.freeze({
  collapsed: Object.freeze({ width: 600, height: 56 }),
  expanded: Object.freeze({ width: 600, height: 440 }),
  settings: Object.freeze({ width: 600, height: 520 }),
});
const DETAIL_SIZE = Object.freeze({ width: 640, height: 560 }), DETAIL_GAP = 8;
const clamp = (value, low, high) => Math.max(low, Math.min(value, high));
const finite = bounds => Number.isFinite(bounds?.x) && Number.isFinite(bounds?.y);

function fitIn(bounds, area) {
  const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
  return { width, height, x: Math.round(clamp(bounds.x, area.x, area.x + area.width - width)), y: Math.round(clamp(bounds.y, area.y, area.y + area.height - height)) };
}
/** Timeline window: a narrow panel about 60% of the work-area height. */
function timelineSize(area) {
  const full = area.height - 2 * SNAP_GAP;
  return { width: Math.min(TIMELINE_WIDTH, area.width - 2 * SNAP_GAP), height: Math.round(Math.min(full, Math.max(Math.min(TIMELINE_MIN.height, full), area.height * TIMELINE_HEIGHT_RATIO))) };
}
/**
 * Bounds for a Console design at (or near) its current position.
 * `initial` places a fresh timeline docked right and centred vertically, and a
 * fresh pill top-centre. A timeline near a side edge stays docked to it.
 */
function layoutBounds(bounds, areas, layout, { mode = 'collapsed', initial = false } = {}) {
  const area = (finite(bounds) && areaFor({ width: 1, height: 1, ...bounds }, areas)) || areaFor({ x: 0, y: 0, width: 1, height: 1 }, areas);
  if (!area) throw new Error('No display work area is available');
  if (layout === 'pill') {
    const size = PILL_SIZES[mode] || PILL_SIZES.collapsed;
    if (initial || !finite(bounds)) return fitIn({ ...size, x: area.x + (area.width - size.width) / 2, y: area.y + 12 }, area);
    return fitIn({ ...size, x: bounds.x, y: bounds.y }, area);
  }
  const size = timelineSize(area);
  const right = area.x + area.width - SNAP_GAP - size.width;
  if (initial || !finite(bounds)) return { ...size, x: Math.round(right), y: Math.round(area.y + (area.height - size.height) / 2) };
  const nearLeft = bounds.x - area.x <= SNAP_THRESHOLD;
  const nearRight = area.x + area.width - (bounds.x + (bounds.width || 0)) <= SNAP_THRESHOLD;
  const x = nearLeft ? area.x + SNAP_GAP : nearRight ? right : bounds.x;
  return fitIn({ ...size, x, y: clamp(bounds.y, area.y + SNAP_GAP, area.y + area.height - SNAP_GAP - size.height) }, area);
}
/**
 * Popup beside `anchor` (the Console), level with the row at `top` px inside it.
 * Opens on the side with more room, preferring the screen centre.
 */
function besideBounds(anchor, areas, { top = 0, size = DETAIL_SIZE, gap = DETAIL_GAP } = {}) {
  const area = areaFor(anchor, areas);
  if (!area) return;
  const width = Math.min(size.width, area.width - 2 * SNAP_GAP), height = Math.min(size.height, area.height - 2 * SNAP_GAP);
  const roomLeft = anchor.x - gap - (area.x + SNAP_GAP), roomRight = area.x + area.width - SNAP_GAP - (anchor.x + anchor.width + gap);
  const preferLeft = anchor.x + anchor.width / 2 > area.x + area.width / 2;
  let side;
  if (roomLeft >= width && (preferLeft || roomRight < width)) side = 'left';
  else if (roomRight >= width) side = 'right';
  else side = roomLeft >= roomRight ? 'left' : 'right';
  const x = side === 'left' ? Math.max(area.x + SNAP_GAP, anchor.x - gap - width) : Math.min(area.x + area.width - SNAP_GAP - width, anchor.x + anchor.width + gap);
  const y = clamp(anchor.y + top, area.y + SNAP_GAP, area.y + area.height - SNAP_GAP - height);
  return { side, x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}
module.exports = { LAYOUTS, TIMELINE_WIDTH, TIMELINE_HEIGHT_RATIO, TIMELINE_MIN, PILL_SIZES, DETAIL_SIZE, timelineSize, layoutBounds, besideBounds };
