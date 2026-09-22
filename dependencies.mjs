import { spawn } from 'node:child_process';
import { existsSync, readFileSync, accessSync, constants } from 'node:fs';
import { join } from 'node:path';

function usable(file) {
  try { accessSync(file, constants.X_OK); return true; } catch { return false; }
}
export function electronExecutable(root, override) {
  if (override) return usable(override) ? override : null;
  try {
    const folder = join(root, 'node_modules', 'electron');
    const required = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies.electron;
    if (JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).version !== required) return null;
    const executable = join(folder, 'dist', readFileSync(join(folder, 'path.txt'), 'utf8').trim());
    return usable(executable) ? executable : null;
  } catch { return null; }
}
function runNpm(args, root) {
  return new Promise((resolve, reject) => {
    // Only fixed arguments below reach the Windows command shell.
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: root, shell: process.platform === 'win32', windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let errors = '', timedOut = false;
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-3000); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 300000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Dependency installation timed out after five minutes'));
      else if (code !== 0) reject(new Error(`npm ${args.join(' ')} failed (${code}): ${errors}`));
      else resolve();
    });
  });
}
export async function ensureDependencies(root, { override = process.env.PI_ANNOTATE_ELECTRON, notify = () => {}, run = runNpm } = {}) {
  const installed = electronExecutable(root, override);
  if (installed) return installed;
  if (override) throw new Error(`PI_ANNOTATE_ELECTRON is not executable: ${override}. Correct or unset it.`);
  notify('Installing Annotate dependencies and Electron. This may take a few minutes…');
  try {
    await run([existsSync(join(root, 'package-lock.json')) ? 'ci' : 'install', '--ignore-scripts', '--no-audit', '--no-fund'], root);
    // Run only this extension’s explicit Electron setup, not arbitrary dependency scripts.
    await run(['run', 'setup'], root);
    const executable = electronExecutable(root);
    if (!executable) throw new Error('Electron is still missing or not executable after setup');
    notify('Annotate dependencies are ready.');
    return executable;
  } catch (error) {
    throw new Error(`Annotate automatic setup failed: ${error.message}. Check npm, network access and directory permissions. Retry /annotate.`);
  }
}
