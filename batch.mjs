export const MAX_BODY = 24 * 1024 * 1024;
export const MAX_ITEMS = 12;
export const deliveryModes = Object.freeze(['followUp', 'steer']);
const fail = message => { throw new Error(message); };
const text = (value, max, name) => typeof value === 'string' && value.length <= max ? value : fail(`Invalid ${name}`);

export function validateBatch(value) {
  if (!value || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id || '')) fail('Invalid batch ID');
  if (!Array.isArray(value.items) || !value.items.length || value.items.length > MAX_ITEMS) fail(`Send 1–${MAX_ITEMS} annotations`);
  const items = value.items.map((item, index) => {
    const comment = text(item.comment, 8000, 'comment').trim();
    if (!comment) fail(`Annotation ${index + 1} needs a comment`);
    const image = text(item.image, 4 * 1024 * 1024, 'PNG');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) fail('Invalid image encoding');
    const png = Buffer.from(image, 'base64');
    if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || png.toString('ascii', 12, 16) !== 'IHDR') fail('Expected a PNG screenshot');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096) fail('Screenshot dimensions exceed 4096px');
    if (!['rectangle', 'freehand'].includes(item.kind)) fail('Invalid selection type');
    const points = item.points;
    if (!Array.isArray(points) || points.length < 2 || points.length > 4000 || points.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) fail('Invalid selection coordinates');
    return { comment, image, kind: item.kind, points, width, height, source: text(item.source || 'Screen', 200, 'source') };
  });
  const deliverAs = value.deliverAs === undefined ? 'followUp' : value.deliverAs;
  if (!deliveryModes.includes(deliverAs)) fail('Invalid delivery mode');
  return { id: value.id, items, deliverAs };
}
