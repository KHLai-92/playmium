export function normalizePreviewPlaybackRate(value: number): number | null {
  return Number.isFinite(value) ? Math.min(2, Math.max(0.25, value)) : null;
}
