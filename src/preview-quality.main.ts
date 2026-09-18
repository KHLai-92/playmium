import { previewPageSupported } from "./preview-entry";
import { qualityLabels, qualityRequestEvent, qualityResponseEvent, type QualityState } from "./preview-quality";

// The controls remain in the isolated world. preview-main.ts composes this
// page adapter with the other MAIN-world features.
// Native player methods verified in YouTube's served 8c3fda2d/base.js:
// setPlaybackQuality is a no-op; setPlaybackQualityRange(min,max) is implemented.
// These are internal APIs, so discovery is scoped and failure is non-fatal.
(() => {
  if (window !== window.top) return;
  type Player = HTMLElement & {
    getAvailableQualityLevels?: () => unknown;
    getPlaybackQuality?: () => unknown;
    setPlaybackQualityRange?: (min: string, max: string) => void;
  };
  const states = new WeakMap<HTMLVideoElement, QualityState>();
  document.addEventListener(qualityRequestEvent, event => {
    if (!previewPageSupported(location.pathname)) return;
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected ||
        !video.classList.contains("skip-ads-preview-prototype-video")) return;
    const host = video.closest(".skip-ads-preview-prototype-pinned");
    if (!host || !host.matches("ytd-video-preview, #inline-preview-player, #video-preview, [data-skip-preview-owned]")) return;
    const detail: unknown = (event as CustomEvent).detail;
    if (typeof detail !== "string" || detail.length > 2048) return;
    let request: { source?: unknown; quality?: unknown };
    try { request = JSON.parse(detail); } catch { return; }
    if (!request || request.source !== video.currentSrc ||
        (request.quality !== undefined && (typeof request.quality !== "string" || !Object.hasOwn(qualityLabels, request.quality)))) return;
    let state = states.get(video);
    if (!state || state.source !== video.currentSrc) {
      state = { source: video.currentSrc, available: [], current: "", requested: null, requestedAt: 0, supported: false, error: "" };
      states.set(video, state);
    }
    let player: Player | null = video.parentElement;
    while (player && host.contains(player) && typeof player.getAvailableQualityLevels !== "function") {
      if (player === host) { player = null; break; }
      player = player.parentElement;
    }
    state.available = [];
    state.current = "";
    state.supported = false;
    try {
      if (player && host.contains(player)) {
        const available = player.getAvailableQualityLevels?.();
        state.available = Array.isArray(available) ? [...new Set(available.filter((q): q is string =>
          typeof q === "string" && q !== "auto" && Object.hasOwn(qualityLabels, q)))].slice(0, 16) : [];
        const current = player.getPlaybackQuality?.();
        state.current = typeof current === "string" && Object.hasOwn(qualityLabels, current) ? current : "";
        state.supported = typeof player.setPlaybackQualityRange === "function" && state.available.length > 0;
        if (typeof request.quality === "string") {
          if (!state.supported || (request.quality !== "auto" && !state.available.includes(request.quality))) {
            state.error = "That quality is no longer available for this preview.";
          } else {
            player.setPlaybackQualityRange!(request.quality, request.quality);
            state.requested = request.quality;
            state.requestedAt = Date.now();
            state.error = "";
          }
        }
      }
    } catch {
      state.error = "YouTube could not change preview quality. Try again.";
    }
    // No play/pause, seek, source replacement, network request or preference write.
    video.dispatchEvent(new CustomEvent(qualityResponseEvent, { detail: JSON.stringify(state) }));
  }, true);
})();
