const { readFileSync, writeFileSync, mkdirSync, openSync, fsyncSync, closeSync, renameSync, rmSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { randomUUID } = require('node:crypto');
const DEFAULTS = Object.freeze({ countdownSeconds: 1, captureMode: 'live', maxAnnotations: 8, defaultDeliverAs: 'followUp' });
function validateSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isInteger(value.countdownSeconds) || value.countdownSeconds < 0 || value.countdownSeconds > 30) throw new Error('Countdown must be a whole number from 0 to 30 seconds.');
  // Older countdown-only files remain valid; newly introduced fields default.
  const { captureMode = DEFAULTS.captureMode, maxAnnotations = DEFAULTS.maxAnnotations, defaultDeliverAs = DEFAULTS.defaultDeliverAs } = value;
  if (!['live', 'preserved'].includes(captureMode)) throw new Error('Choose Live marking or Preserved frame.');
  if (!Number.isInteger(maxAnnotations) || maxAnnotations < 1 || maxAnnotations > 12) throw new Error('Maximum annotations must be a whole number from 1 to 12.');
  if (!['followUp', 'steer'].includes(defaultDeliverAs)) throw new Error('Choose Follow-up or Queued (steering) as the default.');
  return { countdownSeconds: value.countdownSeconds, captureMode, maxAnnotations, defaultDeliverAs };
}
function loadSettings(file) {
  // Preserve preferences written by the earlier dedicated settings build.
  let legacy = {};
  try {
    const previous = validateSettings({ ...DEFAULTS, ...JSON.parse(readFileSync(join(dirname(file), 'annotation-settings.json'), 'utf8')) });
    legacy = { maxAnnotations: previous.maxAnnotations, defaultDeliverAs: previous.defaultDeliverAs };
  } catch { /* No valid legacy preferences. */ }
  let stored = {};
  try { stored = JSON.parse(readFileSync(file, 'utf8')); } catch { /* Missing/corrupt file uses defaults. */ }
  try { return validateSettings({ ...DEFAULTS, ...legacy, ...stored }); }
  catch { return { ...DEFAULTS }; }
}
function saveSettings(file, value) {
  const settings = validateSettings(value), temp = `${file}.${randomUUID()}.tmp`;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let fd;
  try {
    fd = openSync(temp, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(settings) + '\n'); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temp, file);
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temp, { force: true }); }
  return settings;
}
module.exports = { DEFAULTS, validateSettings, loadSettings, saveSettings };
