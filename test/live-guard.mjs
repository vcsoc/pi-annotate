import { createRequire } from 'node:module';
const { runtimeFor } = createRequire(import.meta.url)('../app/runtime.cjs');
export function assertLiveAllowed(env = process.env, platform = process.platform) {
  if (env.ANNOTATE_LIVE_TESTS !== '1') throw new Error('Live desktop tests are disabled by default. Save your work and explicitly set ANNOTATE_LIVE_TESTS=1 to opt in. npm run check does not open a GUI.');
  runtimeFor(platform, env); // In particular, never emulate X11 on a Wayland host.
}
