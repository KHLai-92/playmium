import { previewPageSupported } from "./preview-entry";
import { extractChapters, metadataRequestEvent, metadataResponseEvent, type PreviewMetadata } from './preview-metadata';
import { loadWatchPage } from './preview-watch-data.main';

(() => {
  if (window !== window.top) return;
  const cache = new Map<string, Promise<ReturnType<typeof extractChapters>>>();
  document.addEventListener(metadataRequestEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected || !video.classList.contains('skip-ads-preview-prototype-video') || !previewPageSupported(location.pathname)) return;
    const host = video.closest('.skip-ads-preview-prototype-pinned');
    const href = host?.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href;
    if (!host || !href) return;
    const url = new URL(href);
    const videoId = url.searchParams.get('v');
    const source = video.currentSrc;
    if (url.origin !== location.origin || !videoId || !/^[\w-]{11}$/.test(videoId)) return;
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== 'string' || detail.length > 1024) return;
    try { if (JSON.parse(detail)?.source !== source) return; } catch { return; }
    if (!cache.has(videoId)) {
      if (cache.size >= 12) cache.delete(cache.keys().next().value!);
      cache.set(videoId, (async () => {
        const { data } = await loadWatchPage(videoId);
        return extractChapters(data);
      })());
    }
    void cache.get(videoId)!.then(chapters => respond({ videoId, source, chapters, error: '' }), () => {
      cache.delete(videoId); respond({ videoId, source, chapters: [], error: 'Chapter information could not be loaded. Try again.' });
    });
    const respond = (state: PreviewMetadata) => {
      if (video.isConnected && video.classList.contains('skip-ads-preview-prototype-video') && video.currentSrc === source && host?.contains(video)) {
        video.dispatchEvent(new CustomEvent(metadataResponseEvent, { detail: JSON.stringify(state) }));
      }
    }
  }, true);
})();
