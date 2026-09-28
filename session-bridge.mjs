import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { MAX_BODY, validateBatch } from './batch.mjs';
const fail = (message) => { throw new Error(message); };
const text = (value, max, name) => typeof value === 'string' && value.length <= max ? value : fail(`Invalid ${name}`);

// Private tokens authenticate native companions and registered local Pi sessions.
// Browser requests remain excluded.
export async function createBridge({ onSubmit, onRouteSubmit, onTargets, onSelectTarget, onStop, getInfo = () => ({}), onStatus = () => {}, project, session, shortcut }) {
  const token = randomBytes(32).toString('hex');
  const accepted = new Map();
  let pending = false;
  const server = http.createServer(async (req, res) => {
    const reply = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); } };
    try {
      const auth = Buffer.from(String(req.headers.authorization || ''));
      const expected = Buffer.from(`Bearer ${token}`);
      if (req.headers.origin || req.headers.host !== `127.0.0.1:${server.address()?.port}` || auth.length !== expected.length || !timingSafeEqual(auth, expected)) return reply(401, { error: 'Unauthorized companion' });
      if (req.method === 'GET' && req.url === '/session') return reply(200, { ...getInfo(), project, session, shortcut });
      if (req.method === 'GET' && req.url === '/targets' && onTargets) return reply(200, await onTargets());
      if (req.method !== 'POST' || !['/submit', '/deliver', '/status', ...(onSelectTarget ? ['/target'] : []), ...(onStop ? ['/stop'] : [])].includes(req.url)) return reply(404, { error: 'Not found' });
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
      if (req.url === '/target' || req.url === '/stop') {
        if (pending) return reply(409, { error: 'A delivery or destination change is in progress; retry shortly' });
        pending = true;
        try { return reply(200, req.url === '/target' ? await onSelectTarget(value.id) : await onStop()); }
        finally { pending = false; }
      }
      const batch = validateBatch(value);
      const receipt = `${req.url}:${batch.id}:${req.url === '/submit' ? value.targetId || '' : ''}`;
      if (accepted.has(receipt)) return reply(200, accepted.get(receipt));
      if (pending) return reply(409, { error: 'A batch is already being sent; retry shortly' });
      pending = true;
      try {
        const result = { ok: true, ...await (req.url === '/submit' && onRouteSubmit ? onRouteSubmit(batch, value.targetId) : onSubmit(batch)) };
        accepted.set(receipt, result);
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
