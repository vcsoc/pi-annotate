// Pure workflow/geometry rules shared by the companion and regression tests.
export function applicationForRegion(region, windows) {
  const candidates = windows.filter(w => region.x >= w.x - 1 && region.y >= w.y - 1 && region.x + region.width <= w.x + w.width + 1 && region.y + region.height <= w.y + w.height + 1);
  candidates.sort((a, b) => Number(Boolean(b.floating)) - Number(Boolean(a.floating)) || (a.focusOrder ?? 99999) - (b.focusOrder ?? 99999) || a.width * a.height - b.width * b.height);
  if (!candidates.length) throw new Error('Draw the marked area inside one application window. The full app—not just the marked area—must be captured.');
  return candidates[0];
}
// A mark that crosses the app edge: pick the window where drawing started (else the
// one it overlaps most). 'clip' keeps that window and trims the mark to it; 'extend'
// widens the capture to the window plus the whole mark.
export function targetForMark(region, windows, { overflow = 'clip', start } = {}) {
  try { const app = applicationForRegion(region, windows); return { app, target: app, adjusted: false }; }
  catch (error) { if (!['clip', 'extend'].includes(overflow)) throw error; }
  const overlap = w => Math.max(0, Math.min(region.x + region.width, w.x + w.width) - Math.max(region.x, w.x)) * Math.max(0, Math.min(region.y + region.height, w.y + w.height) - Math.max(region.y, w.y));
  const contains = (w, p) => p && p[0] >= w.x && p[0] <= w.x + w.width && p[1] >= w.y && p[1] <= w.y + w.height;
  const touching = windows.filter(w => overlap(w) > 0);
  if (!touching.length) throw new Error('Start the mark inside the application you want to annotate.');
  const order = (a, b) => Number(Boolean(b.floating)) - Number(Boolean(a.floating)) || (a.focusOrder ?? 99999) - (b.focusOrder ?? 99999);
  const started = touching.filter(w => contains(w, start)).sort(order);
  const app = started[0] || [...touching].sort((a, b) => overlap(b) - overlap(a) || order(a, b))[0];
  if (overflow === 'clip') return { app, target: app, adjusted: 'clipped' };
  const x = Math.floor(Math.min(app.x, region.x)), y = Math.floor(Math.min(app.y, region.y));
  const target = { ...app, x, y, width: Math.ceil(Math.max(app.x + app.width, region.x + region.width)) - x, height: Math.ceil(Math.max(app.y + app.height, region.y + region.height)) - y, extended: true };
  return { app, target, adjusted: 'extended' };
}
export const clampPoints = points => points.map(point => point.map(n => Math.max(0, Math.min(1, n))));
export function relativeMark(region, app) {
  const clamp = n => Math.max(0, Math.min(1, n));
  return [[clamp((region.x - app.x) / app.width), clamp((region.y - app.y) / app.height)], [clamp((region.x + region.width - app.x) / app.width), clamp((region.y + region.height - app.y) / app.height)]];
}
export function validateMark(kind, points) {
  if (!['rectangle', 'freehand'].includes(kind) || !Array.isArray(points) || points.length < 2 || points.length > 1000 || (kind === 'rectangle' && points.length !== 2) || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw new Error('Invalid annotation mark');
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  if (Math.max(...xs) - Math.min(...xs) < .004 || Math.max(...ys) - Math.min(...ys) < .004) throw new Error('Draw a larger area to annotate');
  return points.map(p => [...p]);
}
export function placeNote(mark, areas, size = { width: 340, height: 246 }) {
  const cx = mark.x + mark.width / 2, cy = mark.y + mark.height / 2;
  const area = areas.find(a => cx >= a.x && cx < a.x + a.width && cy >= a.y && cy < a.y + a.height) || areas[0];
  if (!area) throw new Error('No display is available for the annotation note');
  const width = Math.min(size.width, area.width), height = Math.min(size.height, area.height), gap = 12;
  const candidates = [
    { x: mark.x + mark.width + gap, y: mark.y },
    { x: mark.x - width - gap, y: mark.y },
    { x: mark.x, y: mark.y + mark.height + gap },
    { x: mark.x, y: mark.y - height - gap },
  ];
  const chosen = candidates.find(p => p.x >= area.x && p.y >= area.y && p.x + width <= area.x + area.width && p.y + height <= area.y + area.height) || candidates[0];
  return { x: Math.round(Math.max(area.x, Math.min(chosen.x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(chosen.y, area.y + area.height - height))), width, height };
}
export function commitEntry(entries, entry, replaceId, newId) {
  if (replaceId) {
    const index = entries.findIndex(e => e.id === replaceId);
    if (index < 0) throw new Error('The annotation being retaken no longer exists');
    return entries.map((e, i) => i === index ? { ...entry, id: replaceId } : e);
  }
  if (entries.length >= 12) throw new Error('Send or remove some annotations first (12 per batch).');
  return [...entries, { ...entry, id: newId }];
}
