export function normalizedPoint(x, y, rect) {
  return [Math.max(0, Math.min(1, (x - rect.left) / rect.width)), Math.max(0, Math.min(1, (y - rect.top) / rect.height))];
}
export function selectionBounds(points) {
  return { left: Math.min(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])), right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1])) };
}
export function validSelection(points) {
  if (points.length < 2) return false;
  const b = selectionBounds(points);
  return b.right - b.left >= 0.004 && b.bottom - b.top >= 0.004;
}
export function cropRectangle(points, width, height) {
  if (!Array.isArray(points) || points.length !== 2 || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1)) || !validSelection(points)) throw new Error('Draw a capture area first');
  const b = selectionBounds(points);
  const x = Math.floor(b.left * width), y = Math.floor(b.top * height);
  return { x, y, width: Math.max(1, Math.min(width, Math.ceil(b.right * width)) - x), height: Math.max(1, Math.min(height, Math.ceil(b.bottom * height)) - y) };
}
export function drawMark(ctx, kind, points, width, height) {
  if (points.length < 2) return;
  ctx.save(); ctx.strokeStyle = '#ff3b65'; ctx.fillStyle = '#ff3b6518'; ctx.lineWidth = Math.max(3, width / 500);
  ctx.shadowColor = '#ffffff'; ctx.shadowBlur = 2;
  ctx.beginPath();
  if (kind === 'rectangle') {
    const b = selectionBounds(points);
    ctx.rect(b.left * width, b.top * height, (b.right - b.left) * width, (b.bottom - b.top) * height);
  } else {
    ctx.moveTo(points[0][0] * width, points[0][1] * height);
    for (const p of points.slice(1)) ctx.lineTo(p[0] * width, p[1] * height);
    ctx.closePath();
  }
  ctx.fill(); ctx.stroke(); ctx.restore();
}
