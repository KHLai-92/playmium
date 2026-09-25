import { previewPageSupported } from "./preview-entry";
import { infoRequestEvent, infoResponseEvent, descriptionFrom, commentsSeed, commentsFrom, type InfoResponse } from './preview-info';
import { loadWatchPage } from './preview-watch-data.main';

(() => {
  if (window !== window.top) return;
  const access = new WeakMap<HTMLVideoElement, { videoId: string; tokens: Set<string> }>();
  document.addEventListener(infoRequestEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected || !video.classList.contains('playmium-preview-video') || !previewPageSupported(location.pathname)) return;
    const host = video.closest('.playmium-preview-pinned');
    const identity = () => {
      const href = host?.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href;
      if (!href) return '';
      const url = new URL(href); return url.origin === location.origin ? url.searchParams.get('v') ?? '' : '';
    };
    const videoId = identity();
    if (!host || !/^[\w-]{11}$/.test(videoId)) return;
    let request: { source: string; requestId: number; kind: string; token?: string };
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== 'string' || detail.length > 24000) return;
    try { request = JSON.parse(detail); } catch { return; }
    if (!request || request.source !== video.currentSrc || !Number.isSafeInteger(request.requestId) || !['description', 'comments'].includes(request.kind) ||
        request.token !== undefined && typeof request.token !== 'string') return;
    let state = access.get(video);
    if (!state || state.videoId !== videoId) { state = { videoId, tokens: new Set() }; access.set(video, state); }
    const allowed = state;
    const result: InfoResponse = { requestId: request.requestId, source: request.source, videoId, error: '' };
    void (async () => {
      const page = await loadWatchPage(videoId);
      if (request.kind === 'description') result.description = descriptionFrom(page.data, page.player, videoId);
      else {
        const seed = commentsSeed(page.data);
        if (seed) allowed.tokens.add(seed);
        const token = request.token || seed;
        if (!token) result.comments = { items: [], sorts: [], count: '', message: 'Comments are unavailable for this video.' };
        else {
          if (!allowed.tokens.has(token) || !page.context) throw new Error('That comment page is no longer available.');
          // Only YouTube's read-only next endpoint and server-issued continuations.
          const response = await fetch('/youtubei/v1/next?prettyPrint=false', { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context: page.context, continuation: token }), signal: AbortSignal.timeout(15000) });
          if (!response.ok) throw new Error('Comments could not be loaded.');
          const data = await response.json();
          if (data.error) throw new Error('Comments could not be loaded.');
          result.comments = commentsFrom(data);
          const replyTokens = (items: typeof result.comments.items): string[] => items.flatMap(c => [...(c.replies ? [c.replies] : []), ...replyTokens(c.inlineReplies)]);
          for (const next of [result.comments.next, ...result.comments.sorts.map(s => s.token), ...replyTokens(result.comments.items)]) if (next) allowed.tokens.add(next);
        }
      }
    })().catch(error => { result.error = error instanceof Error ? error.message : 'Video information could not be loaded.'; }).finally(() => {
      if (video.isConnected && video.classList.contains('playmium-preview-video') && host.contains(video) && identity() === videoId) {
        video.dispatchEvent(new CustomEvent(infoResponseEvent, { detail: JSON.stringify(result) }));
      }
    });
  }, true);
})();
