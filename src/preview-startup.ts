export const defaultPreviewStartupTimeoutSeconds = 3;
export const defaultPreviewStartupAttempts = 3;

export function normalizePreviewStartupTimeoutSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(2, Math.min(15, Math.round(parsed))) : defaultPreviewStartupTimeoutSeconds;
}

export function normalizePreviewStartupAttempts(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(1, Math.min(3, Math.round(parsed))) : defaultPreviewStartupAttempts;
}

export type PreviewStartupWakeTarget = Readonly<{ isConnected: boolean }>;
export const previewStartupWakeDelaysMs = [0, 100, 300, 700, 1_200] as const;

/**
 * YouTube can replace a thumbnail renderer while starting its native preview.
 * Prefer the clicked node for the initial wake, but let retries refresh their
 * target by video identity. A disconnected target is never returned.
 */
export function resolvePreviewStartupWakeTarget<T extends PreviewStartupWakeTarget>(
  original: T,
  videoId: string,
  candidates: Iterable<T>,
  videoIdOf: (candidate: T) => string | null,
  refresh = false,
): T | null {
  if (!refresh && original.isConnected && videoIdOf(original) === videoId) return original;
  for (const candidate of candidates) {
    if (candidate.isConnected && videoIdOf(candidate) === videoId) return candidate;
  }
  return original.isConnected && videoIdOf(original) === videoId ? original : null;
}
