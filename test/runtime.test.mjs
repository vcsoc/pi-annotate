import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { assertLiveAllowed } from './live-guard.mjs';
const { runtimeFor } = createRequire(import.meta.url)('../app/runtime.cjs');

test('desktop tests need explicit opt-in and cannot emulate X11 on a Wayland host', () => {
  assert.throws(() => assertLiveAllowed({}, 'linux'), /disabled by default/);
  assert.throws(() => assertLiveAllowed({ ANNOTATE_LIVE_TESTS: '1', HYPRLAND_INSTANCE_SIGNATURE: 'live' }, 'linux'), /refuses an Xwayland fallback/);
  assert.doesNotThrow(() => assertLiveAllowed({ ANNOTATE_LIVE_TESTS: '1', WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'Hyprland' }, 'linux'));
});

test('Wayland chooses native ozone even when shell hints ask for X11', () => {
  assert.deepEqual(runtimeFor('linux', { WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'Hyprland', OZONE_PLATFORM: 'x11' }), { wayland: true, backend: 'hyprland', ozone: 'wayland' });
  assert.equal(runtimeFor('linux', { WAYLAND_DISPLAY: 'wayland-1', XDG_CURRENT_DESKTOP: 'sway' }).backend, 'sway');
});
test('missing Wayland display cannot silently trigger risky Xwayland fallback', () => {
  for (const env of [{ XDG_SESSION_TYPE: 'wayland' }, { XDG_SESSION_TYPE: 'x11', HYPRLAND_INSTANCE_SIGNATURE: 'live-compositor' }, { SWAYSOCK: '/live-sway-socket' }]) assert.throws(() => runtimeFor('linux', env), /refuses an Xwayland fallback/);
});
test('genuine X11, macOS, Windows and generic Wayland keep their native routes', () => {
  assert.deepEqual(runtimeFor('linux', { XDG_SESSION_TYPE: 'x11' }), { wayland: false, backend: null, ozone: 'x11' });
  for (const platform of ['win32', 'darwin']) assert.deepEqual(runtimeFor(platform, {}), { wayland: false, backend: null, ozone: undefined });
  assert.deepEqual(runtimeFor('linux', { WAYLAND_DISPLAY: 'wayland-0', XDG_CURRENT_DESKTOP: 'GNOME' }), { wayland: true, backend: null, ozone: 'wayland' });
});
test('compositor socket fallback only applies when desktop identity is absent', () => {
  assert.equal(runtimeFor('linux', { WAYLAND_DISPLAY: 'wayland-1', HYPRLAND_INSTANCE_SIGNATURE: 'live' }).backend, 'hyprland');
  assert.equal(runtimeFor('linux', { WAYLAND_DISPLAY: 'wayland-1', HYPRLAND_INSTANCE_SIGNATURE: 'old', XDG_CURRENT_DESKTOP: 'GNOME' }).backend, null);
});
