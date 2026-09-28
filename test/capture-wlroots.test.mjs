import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { displayBounds, desktopBounds, snapshotDesktop, waitForCapture } = createRequire(import.meta.url)('../app/capture-wlroots.cjs');
const monitors = [{ x: -1920, y: 0, width: 1920, height: 1080, scale: 1, transform: 0 }, { x: 0, y: 0, width: 3840, height: 2160, scale: 2, transform: 0 }];
test('preserved frame maps mixed-DPI and negative-origin displays to logical pixels', () => {
  const areas = displayBounds('hyprland', monitors);
  assert.deepEqual(desktopBounds(areas), { x: -1920, y: 0, width: 3840, height: 1080 });
  assert.deepEqual(displayBounds('hyprland', [{ x: 0, y: -1920, width: 3840, height: 2160, scale: 2, transform: 1 }]), [{ x: 0, y: -1920, width: 1080, height: 1920 }]);
  assert.deepEqual(displayBounds('sway', [{ active: true, rect: areas[0] }, { active: false }]), [areas[0]]);
  assert.throws(() => displayBounds('hyprland', []), /valid display/);
  assert.throws(() => desktopBounds([{ x: 0, y: 0, width: 16000, height: 16000 }]), /too large/);
});
test('one pre-selection screenshot supplies both backdrop and complete app; no second capture', async () => {
  const calls = [], crops = [];
  const frame = await snapshotDesktop('hyprland', {
    run: async (command, args) => { calls.push([command, args]); return { stdout: command === 'hyprctl' ? JSON.stringify(monitors) : Buffer.from('menu open') }; },
    decode: bytes => ({ getSize: () => ({ width: 3840, height: 1080 }), crop(rect) { crops.push(rect); return { toDataURL: () => bytes.toString(), resize() { return this; } }; } }),
  });
  assert.deepEqual(calls[1], ['grim', ['-s', '1', '-g', '-1920,0 3840x1080', '-']]);
  assert.equal(frame.preview(frame.areas[0]), 'menu open');
  assert.equal(frame.crop({ x: -1800, y: 100, width: 1200, height: 800 }).toDataURL(), 'menu open');
  assert.deepEqual(crops[1], { x: 120, y: 100, width: 1200, height: 800 });
  assert.equal(calls.length, 2);
  assert.throws(() => frame.crop({ x: -2000, y: 0, width: 1200, height: 800 }), /entire application/);
});
test('invalid frame geometry or cancelled capture cannot yield evidence', async () => {
  const run = async command => ({ stdout: command === 'hyprctl' ? JSON.stringify(monitors) : Buffer.alloc(0) });
  await assert.rejects(snapshotDesktop('hyprland', { run, decode: () => ({ getSize: () => ({ width: 1, height: 1 }) }) }), /geometry changed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(snapshotDesktop('hyprland', { signal: controller.signal, run: () => { throw new Error('Must not capture'); } }), /abort/i);
  await assert.rejects(waitForCapture(3000, controller.signal), /abort/i);
  await assert.rejects(waitForCapture(999999), /Invalid capture delay/);
});
