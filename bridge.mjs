import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const MAX_BODY = 24 * 1024 * 1024;
export const MAX_ITEMS = 12;
const fail = (message) => { throw new Error(message); };
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
  return { id: value.id, items };
}

// Only the native companion holds this per-launch token. Browsers cannot submit.
export async function createBridge({ onSubmit, onStatus = () => {}, project, session, shortcut }) {
  const token = randomBytes(32).toString('hex');
  const accepted = new Map();
  let pending = false;
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); } };
    try {
      const auth = Buffer.from(String(req.headers.authorization || ''));
      const expected = Buffer.from(`Bearer ${token}`);
      if (req.headers.origin || req.headers.host !== `127.0.0.1:${server.address()?.port}` || auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(401, { error: 'Unauthorized companion' });
      if (req.method === 'GET' && req.url === '/session') return reply(200, { project, session, shortcut });
      if (req.method !== 'POST' || !['/submit', '/status'].includes(req.url)) return reply(404, { error: 'Not found' });
      if (!String(req.headers['content-type']).startsWith('application/json')) return reply(415, { error: 'Expected JSON' });
      if (Number(req.headers['content-length']) > MAX_BODY) return reply(413, { error: 'Batch too large' });
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) { reply(413, { error: 'Batch too large' }); return; }
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (req.url === '/status') { onStatus(text(value.message, 500, 'status')); return reply(200, { ok: true }); }
      const batch = validateBatch(value);
      if (accepted.has(batch.id)) return reply(200, accepted.get(batch.id));
      if (pending) return reply(409, { error: 'A batch is already being sent; retry shortly' });
      pending = true;
      try {
        const result = { ok: true, ...await onSubmit(batch) };
        accepted.set(batch.id, result);
        if (accepted.size > 100) accepted.delete(accepted.keys().next().value);
        reply(200, result);
      } finally { pending = false; }
    } catch (error) { reply(400, { error: error.message || 'Invalid annotation request' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, token, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
