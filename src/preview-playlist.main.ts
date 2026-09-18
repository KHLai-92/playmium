import { bindPlaylistSource, extractPlaylist, isPlaybackTroubleNotification,
  isPlaylistId, normalizePlaylistBrokerTimeoutMultipliers, normalizePlaylistPreviewRetentionCapacity, normalizePlaylistSeed,
  normalizePlaylistStageRetryLimit,
  playlistPrefetchEvent, playlistRequestEvent, playlistPrefetchCancelEvent, playlistPreviewRetentionEvent, playlistResponseEvent,
  playlistSelectEvent, playlistSelectPhaseEvent, playlistWarmEvent, type PreviewPlaylist,
  type PlaylistPreviewTrigger, type PreviewPlaylistSeed, validatedPlaylistPlayerResponse } from "./preview-playlist";
import { cancelPreviewPreparation, preparePreview, previewVideo, setPreviewRetentionCapacity } from "./preview-playback.experiment";
import { loadWatchPage } from "./preview-watch-data.main";
import { qualityLabels } from "./preview-quality";
import { createExpiringLru, createPlaylistCatalog } from "./preview-playlist-catalog";

(() => {
  if (window !== window.top) return;
  type AllowedPlaylist = { playlistId: string; videoIds: Set<string>; host: Element };
  const playlistSeeds = createExpiringLru<string, PreviewPlaylistSeed>({ capacity: 12, debugName: "playlist-seed" });
  const playlistKey = (videoId: string, playlistId: string) => `${videoId}:${playlistId}`;
  const playlistLoads = createPlaylistCatalog<PreviewPlaylist>(async ({ videoId, playlistId }, options) => {
    const seed = playlistSeeds.get(playlistKey(videoId, playlistId));
    let best = extractPlaylist({}, videoId, playlistId, "", seed);
    const candidates = [videoId, ...(seed?.items.map(item => item.videoId).filter(itemId => itemId !== videoId).slice(0, 1) ?? [])];
    for (const candidateId of candidates) {
      try {
        const { data } = await loadWatchPage(candidateId, playlistId, options);
        const result = extractPlaylist(data, videoId, playlistId, "", seed);
        if (result && (!best || result.items.length > best.items.length)) best = result;
        if (result && result.items.length > (seed?.items.length ?? 0)) return result;
      } catch { /* Try one alternate visible item before using the seed-only rescue. */ }
    }
    return best;
  }, { debugName: "playlist-load" });
  const allowed = new WeakMap<HTMLVideoElement, AllowedPlaylist>();
  if (typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", () => { playlistLoads.dispose(); playlistSeeds.dispose(); }, { once: true });
  }
  const selectionGeneration = new WeakMap<HTMLVideoElement, number>();
  if (typeof MutationObserver !== "undefined") {
    const removePlaybackTroubleNotification = (renderer: HTMLElement & { data?: unknown }) => {
      if (renderer.isConnected && isPlaybackTroubleNotification(renderer.data)) renderer.remove();
    };
    const troubleObserver = new MutationObserver(records => {
      if (!document.querySelector("video.skip-ads-preview-prototype-video[data-skip-preview-playlist-request]")) return;
      const renderers = new Set<HTMLElement & { data?: unknown }>();
      for (const record of records) for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        const closest = added.matches("yt-notification-action-renderer") ? added : added.closest("yt-notification-action-renderer");
        if (closest) renderers.add(closest as HTMLElement & { data?: unknown });
        for (const renderer of added.querySelectorAll("yt-notification-action-renderer")) renderers.add(renderer as HTMLElement & { data?: unknown });
      }
      for (const renderer of renderers) {
        removePlaybackTroubleNotification(renderer);
        queueMicrotask(() => removePlaybackTroubleNotification(renderer));
        setTimeout(() => removePlaybackTroubleNotification(renderer), 50);
      }
    });
    troubleObserver.observe(document, { childList: true, subtree: true });
  }
  function context(video: HTMLVideoElement) {
    const host = video.closest(".skip-ads-preview-prototype-pinned");
    const href = host?.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href;
    if (!host || !href) return null;
    const url = new URL(href);
    const videoId = url.searchParams.get("v");
    const playlistId = (host as HTMLElement).dataset.skipPreviewPlaylistId;
    return videoId && playlistId && isPlaylistId(playlistId) ? { host, href, videoId, playlistId } : null;
  }
  function selectPhase(video: HTMLVideoElement, detail: Record<string, unknown>) {
    video.dispatchEvent(new CustomEvent(playlistSelectPhaseEvent, { detail: JSON.stringify(detail) }));
  }
  function publishPlaylist(video: HTMLVideoElement, host: Element, result: PreviewPlaylist, source: string, provisional = false) {
    const current = bindPlaylistSource(result, source);
    allowed.set(video, { playlistId: current.playlistId, videoIds: new Set(current.items.map(item => item.videoId)), host });
    video.dispatchEvent(new CustomEvent(playlistResponseEvent, { detail: JSON.stringify(provisional ? { ...current, provisional: true } : current) }));
    return current;
  }
  document.addEventListener(playlistWarmEvent, event => {
    if (event.target !== document) return;
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== "string" || detail.length > 2048) return;
    let request: { href?: unknown; videoId?: unknown; playlistId?: unknown; seed?: unknown };
    try { request = JSON.parse(detail); } catch { return; }
    if (typeof request.href !== "string" || typeof request.videoId !== "string" || !/^[\w-]{11}$/.test(request.videoId) ||
        typeof request.playlistId !== "string" || !isPlaylistId(request.playlistId)) return;
    try {
      const url = new URL(request.href, location.href);
      if (url.origin !== location.origin || url.pathname !== "/watch" || url.searchParams.get("v") !== request.videoId ||
          url.searchParams.get("list") !== request.playlistId) return;
    } catch { return; }
    const seed = normalizePlaylistSeed(request.seed, request.videoId);
    if (seed) playlistSeeds.set(playlistKey(request.videoId, request.playlistId), seed);
    void playlistLoads.load({ videoId: request.videoId, playlistId: request.playlistId }).catch(() => {});
  }, true);
  document.addEventListener(playlistRequestEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected || !video.classList.contains("skip-ads-preview-prototype-video")) return;
    const active = context(video);
    if (!active) return;
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== "string" || detail.length > 2048) return;
    let request: { source?: unknown; videoId?: unknown; playlistId?: unknown; seed?: unknown };
    try {
      request = JSON.parse(detail);
      if (request.source !== video.currentSrc || request.videoId !== active.videoId || request.playlistId !== active.playlistId) return;
    } catch { return; }
    const requestedSource = video.currentSrc;
    const seed = normalizePlaylistSeed(request.seed, active.videoId) ?? playlistSeeds.get(playlistKey(active.videoId, active.playlistId));
    if (seed) playlistSeeds.set(playlistKey(active.videoId, active.playlistId), seed);
    const rescued = extractPlaylist({}, active.videoId, active.playlistId, "", seed);
    if (rescued) publishPlaylist(video, active.host, rescued, requestedSource, true);
    void playlistLoads.load({ videoId: active.videoId, playlistId: active.playlistId }).then(result => {
      if (!video.isConnected || video.currentSrc !== requestedSource) return;
      const current = publishPlaylist(video, active.host, result, requestedSource);
    }, () => {
      if (!video.isConnected || video.currentSrc !== requestedSource) return;
      if (rescued) { publishPlaylist(video, active.host, rescued, requestedSource); return; }
      video.dispatchEvent(new CustomEvent(playlistResponseEvent, { detail: JSON.stringify({
        playlistId: active.playlistId, source: requestedSource, videoId: active.videoId, title: "Playlist", currentIndex: 0, items: [],
        error: "Playlist information could not be loaded. Try again.",
      }) }));
    });
  }, true);
  document.addEventListener(playlistPreviewRetentionEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return;
    const choices = allowed.get(video);
    if (!choices || !choices.host.contains(video)) return;
    let request: { capacity?: unknown };
    try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
    setPreviewRetentionCapacity(normalizePlaylistPreviewRetentionCapacity(request.capacity));
  }, true);
  document.addEventListener(playlistPrefetchEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return;
    const choices = allowed.get(video);
    if (!choices || !choices.host.contains(video)) return;
    let request: { actionId?: unknown; startedAtMs?: unknown; trigger?: unknown; videoId?: unknown; playlistId?: unknown;
      retentionCapacity?: unknown; retryLimit?: unknown; timeoutMultipliers?: unknown; rect?: unknown };
    try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
    if (request.playlistId !== choices.playlistId || typeof request.videoId !== "string" || !choices.videoIds.has(request.videoId) ||
        typeof request.actionId !== "string" || !request.actionId || request.actionId.length > 100 ||
        typeof request.startedAtMs !== "number" || !Number.isFinite(request.startedAtMs) ||
        !["hover", "focus", "click"].includes(String(request.trigger))) return;
    const rect = request.rect as Partial<{ left: unknown; top: unknown; width: unknown; height: unknown }> | undefined;
    if (rect && [rect.left, rect.top, rect.width, rect.height].every(value => typeof value === "number" && Number.isFinite(value))) {
      void preparePreview(video, request.videoId, { rect: rect as { left: number; top: number; width: number; height: number },
        actionId: request.actionId, startedAtMs: request.startedAtMs, trigger: request.trigger as PlaylistPreviewTrigger,
        retentionCapacity: normalizePlaylistPreviewRetentionCapacity(request.retentionCapacity),
        retryLimit: normalizePlaylistStageRetryLimit(request.retryLimit),
        timeoutMultipliers: normalizePlaylistBrokerTimeoutMultipliers(request.timeoutMultipliers),
      })?.catch(() => {});
    }
  }, true);
  document.addEventListener(playlistPrefetchCancelEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected) return;
    const choices = allowed.get(video);
    if (!choices || !choices.host.contains(video)) return;
    let request: { actionId?: unknown; videoId?: unknown; playlistId?: unknown; reason?: unknown };
    try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
    if (request.playlistId !== choices.playlistId || typeof request.videoId !== "string" || !choices.videoIds.has(request.videoId) ||
        typeof request.actionId !== "string" || !request.actionId || request.actionId.length > 100) return;
    cancelPreviewPreparation(request.videoId, request.actionId,
      typeof request.reason === "string" && request.reason ? request.reason.slice(0, 80) : "intent-ended");
  }, true);
  document.addEventListener(playlistSelectEvent, event => {
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected || !video.classList.contains("skip-ads-preview-prototype-video")) return;
    const choices = allowed.get(video);
    if (!choices || !choices.host.contains(video)) return;
    const detail = (event as CustomEvent).detail;
    if (typeof detail !== "string" || detail.length > 2048) return;
    let request: { source?: unknown; actionId?: unknown; startedAtMs?: unknown; videoId?: unknown; playlistId?: unknown; requestId?: unknown;
      retentionCapacity?: unknown; retryLimit?: unknown; timeoutMultipliers?: unknown; rect?: unknown; quality?: unknown };
    try { request = JSON.parse(detail); } catch { return; }
    if (request.source !== video.currentSrc || request.playlistId !== choices.playlistId || typeof request.videoId !== "string" ||
        !choices.videoIds.has(request.videoId) || typeof request.requestId !== "string" || request.requestId.length > 80 ||
        typeof request.actionId !== "string" || !request.actionId || request.actionId.length > 100 ||
        typeof request.startedAtMs !== "number" || !Number.isFinite(request.startedAtMs) ||
        request.quality !== undefined && (typeof request.quality !== "string" || !Object.hasOwn(qualityLabels, request.quality))) return;
    const rect = request.rect as Partial<{ left: unknown; top: unknown; width: unknown; height: unknown }> | undefined;
    if (!rect || ![rect.left, rect.top, rect.width, rect.height].every(value => typeof value === "number" && Number.isFinite(value))) return;
    const generation = (selectionGeneration.get(video) ?? 0) + 1;
    selectionGeneration.set(video, generation);
    const selected = { source: request.source, actionId: request.actionId, startedAtMs: request.startedAtMs, videoId: request.videoId,
      playlistId: request.playlistId, requestId: request.requestId,
      quality: typeof request.quality === "string" ? request.quality : undefined } as const;
    void previewVideo(choices.host as HTMLElement, {
      ...selected, rect: rect as { left: number; top: number; width: number; height: number },
      retentionCapacity: normalizePlaylistPreviewRetentionCapacity(request.retentionCapacity),
      retryLimit: normalizePlaylistStageRetryLimit(request.retryLimit),
      timeoutMultipliers: normalizePlaylistBrokerTimeoutMultipliers(request.timeoutMultipliers),
    }, { onPhase(phase) {
      if (selectionGeneration.get(video) === generation && video.isConnected) selectPhase(video, { ...selected, ...phase });
    } }).then(result => {
      if (result.phase === "error" && selectionGeneration.get(video) === generation && video.isConnected)
        selectPhase(video, { ...selected, ...result });
    }, () => { /* A replaced or closed preview cannot publish a stale phase. */ });
  }, true);
})();
