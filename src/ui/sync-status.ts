import { SyncReport } from '../core/model';
import { Preview, conflictCount } from './preview-model';

export function previewStatus(preview?: Preview): string {
  if (!preview) return 'Fetch to prepare a preview';
  if (conflictCount(preview)) return 'Needs review';
  if (preview.diagnostics.some((d) => d.level === 'error')) return 'Needs attention';
  if (preview.canSync) return 'Ready to sync';
  if (
    omittedCount(preview) ||
    [...preview.variables, ...preview.styles].some((row) => row.action === 'skipped')
  )
    return 'No pending changes · items skipped';
  return 'Up to date';
}

export function omittedCount(preview?: Preview): number {
  if (!preview) return 0;
  const paths = new Set([...preview.variables, ...preview.styles].map((row) => row.path));
  return new Set(
    preview.diagnostics
      .filter(
        (d) => d.token && (d.level === 'error' || d.code === 'UNSUPPORTED') && !paths.has(d.token),
      )
      .map((d) => `${d.theme}:${d.token}`),
  ).size;
}

export function reportHasIssues(report: SyncReport): boolean {
  return !!(
    report.cancelled ||
    report.failed ||
    report.skipped ||
    report.diagnostics.some((d) => d.level === 'error')
  );
}

export function reportTitle(report: SyncReport): string {
  if (report.cancelled) return 'Sync stopped';
  if (report.failed)
    return `Sync finished with ${report.failed} failed ${report.failed === 1 ? 'item' : 'items'}`;
  if (report.skipped)
    return `Synced with ${report.skipped} skipped ${report.skipped === 1 ? 'item' : 'items'}`;
  if (report.diagnostics.some((d) => d.level === 'error')) return 'Sync finished with errors';
  return 'Sync complete';
}

export function syncNotification(report: SyncReport): string {
  const counts = [
    report.created ? `${report.created} created` : '',
    report.updated ? `${report.updated} updated` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return `${reportTitle(report)}${counts ? ` · ${counts}` : ''}`;
}
