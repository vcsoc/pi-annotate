import { mkdirSync, writeFileSync, renameSync, readdirSync, readFileSync, lstatSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

export const registryDirectory = () => process.env.PI_ANNOTATE_REGISTRY_DIR || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'annotate', 'sessions');
const validId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
function valid(record) {
  return record && validId(record.id) && /^http:\/\/127\.0\.0\.1:\d+$/.test(record.url) && /^[a-f0-9]{64}$/.test(record.token) && typeof record.project === 'string' && typeof record.session === 'string';
}
export function advertise(record, directory = registryDirectory()) {
  if (!valid(record)) throw new Error('Invalid Annotate destination');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, record.id + '.json'), temp = file + '.' + randomUUID();
  writeFileSync(temp, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  renameSync(temp, file);
  return () => { try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; } };
}
export function records(directory = registryDirectory()) {
  let names; try { names = readdirSync(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return names.filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).slice(0, 256).flatMap(name => {
    try {
      const file = join(directory, name), stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 16384 || (process.platform !== 'win32' && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) return [];
      const record = JSON.parse(readFileSync(file, 'utf8'));
      return valid(record) && name === record.id + '.json' ? [record] : [];
    } catch { return []; }
  });
}
export async function request(record, path, body, timeout = 1500) {
  if (!valid(record) || !['/session', '/target', '/submit', '/deliver', '/stop'].includes(path)) throw new Error('Invalid destination request');
  const response = await fetch(record.url + path, {
    method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${record.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Destination request failed');
  return value;
}
export async function activeTargets(directory = registryDirectory()) {
  const available = await Promise.all(records(directory).map(async record => {
    try {
      const status = await request(record, '/session');
      if (status.targetId !== record.id || status.project !== record.project || status.session !== record.session) return;
      return { ...record, name: typeof status.name === 'string' ? status.name.slice(0, 120) : '', consoleOpen: status.consoleOpen === true };
    } catch { /* Closed/reloaded sessions are not valid destinations. */ }
  }));
  return available.filter(Boolean).sort((a, b) => a.project.localeCompare(b.project) || a.id.localeCompare(b.id));
}
export const publicTarget = target => ({ id: target.id, project: target.project, session: target.session, name: target.name || '' });

export function createRouting(self, { directory = registryDirectory(), localSubmit, list = () => activeTargets(directory), send = request } = {}) {
  let selected = self, revision = 0;
  const attempts = new Map();
  return {
    selected: () => publicTarget(selected),
    async targets() {
      const live = await list();
      return { selected: publicTarget(selected), revision, available: live.some(t => t.id === selected.id), targets: live.map(publicTarget) };
    },
    async select(id) {
      if (!validId(id)) throw new Error('Invalid project/session selection');
      const target = (await list()).find(t => t.id === id);
      if (!target) throw new Error('That Pi session is no longer available. Open/reload Pi in that project first.');
      selected = target; revision++;
      return { selected: publicTarget(selected), revision };
    },
    async submit(batch, expectedId) {
      // The visible dropdown is part of the Send transaction. A command in a
      // different terminal must not silently redirect a click on stale UI.
      if (expectedId !== selected.id) throw new Error('Destination changed. Review the selected project and Send again.');
      const target = selected;
      const previous = attempts.get(batch.id);
      if (previous && previous !== target.id) throw new Error('This batch was already attempted for another session. Retry the original destination or discard it before switching.');
      const live = (await list()).find(t => t.id === target.id);
      if (!live) throw new Error('Selected Pi session is offline. Annotations have not been redirected.');
      attempts.set(batch.id, target.id);
      if (attempts.size > 100) attempts.delete(attempts.keys().next().value);
      // /deliver always targets the recipient's own immutable session, never
      // its dropdown. This prevents routing loops between open Consoles.
      const result = target.id === self.id ? await localSubmit(batch) : await send(live, '/deliver', batch, 30000);
      return { ...result, destination: publicTarget(target) };
    },
  };
}
