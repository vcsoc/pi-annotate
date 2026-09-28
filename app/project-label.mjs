// Browser-safe formatting; retain the destination's native path separators.
export function projectLabel(project) {
  const path = String(project || '');
  const trimmed = path.replace(/[\\/]+$/, '');
  if (!trimmed || /^[A-Za-z]:$/.test(trimmed)) return path;
  const split = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return split < 0 ? trimmed : `${trimmed.slice(split + 1)} : ${trimmed.slice(0, split + 1)}`;
}
