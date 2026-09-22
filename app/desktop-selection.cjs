// Validate desktop-global DIP coordinates separately from image coordinates.
function selection(kind, points, displays) {
  if (!['rectangle', 'freehand'].includes(kind) || !Array.isArray(points) || points.length < 2 || points.length > 1000 || (kind === 'rectangle' && points.length !== 2)) throw new Error('Invalid desktop mark');
  if (points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n)) || !displays.some(d => p[0] >= d.x && p[0] <= d.x + d.width && p[1] >= d.y && p[1] <= d.y + d.height))) throw new Error('Mark must stay on the connected displays');
  const x = Math.floor(Math.min(...points.map(p => p[0]))), y = Math.floor(Math.min(...points.map(p => p[1])));
  const region = { x, y, width: Math.ceil(Math.max(...points.map(p => p[0]))) - x, height: Math.ceil(Math.max(...points.map(p => p[1]))) - y };
  if (region.width < 3 || region.height < 3) throw new Error('Draw a larger marked area');
  return { kind, points: points.map(p => [...p]), region };
}
function pointsInApp(points, target) {
  return points.map(p => [(p[0] - target.x) / target.width, (p[1] - target.y) / target.height]);
}
module.exports = { selection, pointsInApp };
