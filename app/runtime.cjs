// Keep capture/rendering aligned with the actual desktop; never silently route
// a Wayland session through Xwayland. Pure so startup safety is testable without GUI.
function runtimeFor(platform, env) {
  const linux = platform === 'linux';
  const wayland = linux && Boolean(env.WAYLAND_DISPLAY);
  const desktop = env.XDG_CURRENT_DESKTOP || '';
  const waylandSession = linux && (env.XDG_SESSION_TYPE === 'wayland' || Boolean(env.HYPRLAND_INSTANCE_SIGNATURE || env.SWAYSOCK));
  if (waylandSession && !wayland) throw new Error('Wayland session detected but WAYLAND_DISPLAY is missing. Start Pi from your normal desktop terminal. Annotate refuses an Xwayland fallback.');
  const backend = !wayland ? null : /hyprland/i.test(desktop) || (!desktop && env.HYPRLAND_INSTANCE_SIGNATURE) ? 'hyprland' : /sway/i.test(desktop) || (!desktop && env.SWAYSOCK) ? 'sway' : null;
  return { wayland, backend, ozone: linux ? (wayland ? 'wayland' : 'x11') : undefined };
}
module.exports = { runtimeFor };
