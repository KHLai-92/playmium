export type Chapter = { title: string; start: number; thumbnail?: string };
export const metadataRequestEvent = "skip-ads-preview-metadata-request";
export const metadataResponseEvent = "skip-ads-preview-metadata-response";
export type PreviewMetadata = { videoId: string; source: string; chapters: Chapter[]; error: string };

// Parse a JSON assignment without evaluating page script or accepting trailing JS.
export function assignedJSON(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(html.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}
export function nativeText(value: any): string {
  if (typeof value === 'string') return value;
  return typeof value?.simpleText === 'string' ? value.simpleText : Array.isArray(value?.runs) ? value.runs.map((r: any) => r.text ?? '').join('') : typeof value?.content === 'string' ? value.content : '';
}
export function extractChapters(data: unknown): Chapter[] {
  const found = new Map<number, Chapter>();
  const stack: any[] = [data]; let visited = 0;
  while (stack.length && visited++ < 100000) {
    const value = stack.pop();
    if (!value || typeof value !== 'object') continue;
    const chapter = value.chapterRenderer;
    const marker = value.macroMarkersListItemRenderer;
    const title = nativeText(chapter?.title ?? marker?.title).slice(0, 400);
    const start = chapter ? Number(chapter.timeRangeStartMillis) / 1000 : Number(marker?.onTap?.watchEndpoint?.startTimeSeconds ?? marker?.onTap?.innertubeCommand?.watchEndpoint?.startTimeSeconds);
    if (title && Number.isFinite(start) && start >= 0 && !found.has(start)) {
      const thumbnail = (chapter?.thumbnail?.thumbnails ?? marker?.thumbnail?.thumbnails)?.at(-1)?.url;
      found.set(start, { title, start, ...(typeof thumbnail === 'string' && /^https:\/\/([\w-]+\.)?(ytimg\.com|ggpht\.com)\//.test(thumbnail) ? { thumbnail } : {}) });
    }
    stack.push(...Object.values(value));
  }
  return [...found.values()].sort((a, b) => a.start - b.start).slice(0, 500);
}
