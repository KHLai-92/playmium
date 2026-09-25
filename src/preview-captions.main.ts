import { previewPageSupported } from "./preview-entry";
import { captionRequestEvent, captionResponseEvent, type CaptionState } from "./preview-captions";

// Native APIs verified in YouTube's 8c3fda2d player/captions sources.
// toggleSubtitlesOn only enables; it is NOT an on/off toggle.
(() => {
  if (window !== window.top) return;
  type Player = HTMLElement & {
    isSubtitlesOn?: () => boolean;
    toggleSubtitles?: () => void;
    toggleSubtitlesOn?: () => void;
    getOption?: (module: string, option: string, options?: unknown) => unknown;
    setOption?: (module: string, option: string, value: unknown) => void;
  };
  document.addEventListener(captionRequestEvent, event => {
    if (!previewPageSupported(location.pathname)) return;
    const video = event.target;
    if (!(video instanceof HTMLVideoElement) || !video.isConnected || !video.classList.contains("playmium-preview-video")) return;
    const host = video.closest(".playmium-preview-pinned");
    if (!host || !host.matches("ytd-video-preview, #inline-preview-player, #video-preview, [data-skip-preview-owned]")) return;
    const detail: unknown = (event as CustomEvent).detail;
    if (typeof detail !== "string" || detail.length > 2048) return;
    let request: { source?: unknown; enabled?: unknown; track?: unknown; translation?: unknown };
    try { request = JSON.parse(detail); } catch { return; }
    if (!request || request.source !== video.currentSrc || request.enabled !== undefined && typeof request.enabled !== "boolean" ||
        request.track !== undefined && (typeof request.track !== "string" || request.track.length > 256) ||
        request.translation !== undefined && (typeof request.translation !== "string" || request.translation.length > 64)) return;
    const overlay = Boolean(host.querySelector(".ytp-caption-segment")?.textContent);
    const state: CaptionState = { source: video.currentSrc, enabled: overlay, available: overlay, nativeSupported: false, error: "",
      tracks: [], selectedTrack: "", languageSupported: false, translations: [], translation: "" };
    let player: Player | null = video.parentElement;
    while (player && host.contains(player) && typeof player.isSubtitlesOn !== "function") {
      if (player === host) { player = null; break; }
      player = player.parentElement;
    }
    try {
      if (player && host.contains(player) && player.isSubtitlesOn) {
        state.enabled = Boolean(player.isSubtitlesOn());
        const tracks = player.getOption?.("captions", "tracklist", { includeAsr: true });
        type NativeLanguage = { languageCode: string; languageName?: string };
        type NativeTrack = { languageCode: string; vssId?: string; kind?: string; name?: string; displayName?: string; languageName?: string;
          isTranslateable?: boolean; translationLanguage?: NativeLanguage };
        const nativeTracks: NativeTrack[] = Array.isArray(tracks) ? tracks.filter(t => t && typeof t.languageCode === "string").slice(0, 64) : [];
        const trackId = (t: NativeTrack) => `${t.languageCode}:${t.vssId ?? t.kind ?? ""}:${t.name ?? ""}`.slice(0, 256);
        state.tracks = nativeTracks.map(t => ({ id: trackId(t), languageCode: t.languageCode,
          label: (typeof t.displayName === "string" && t.displayName || `${typeof t.languageName === "string" && t.languageName || t.languageCode}${t.kind === "asr" ? " (auto-generated)" : ""}`).slice(0, 160) }));
        state.languageSupported = typeof player.setOption === "function" && nativeTracks.length > 0;
        state.available = state.enabled || overlay || Array.isArray(tracks) && tracks.length > 0;
        state.nativeSupported = typeof player.toggleSubtitles === "function" ||
          typeof player.toggleSubtitlesOn === "function" && typeof player.setOption === "function";
        const current = player.getOption?.("captions", "track") as NativeTrack | undefined;
        const languages = player.getOption?.("captions", "translationLanguages");
        const nativeLanguages: NativeLanguage[] = Array.isArray(languages) ? languages.filter(l => l && typeof l.languageCode === "string").slice(0, 256) : [];
        state.translations = nativeLanguages.map(l => ({ languageCode: l.languageCode, label: typeof l.languageName === "string" ? l.languageName : l.languageCode }));
        if (typeof request.track === "string" || typeof request.translation === "string") {
          const track = nativeTracks.find(t => trackId(t) === request.track) ??
            (request.track === undefined ? nativeTracks.find(t => current?.languageCode === t.languageCode) ?? nativeTracks[0] : undefined);
          const translation = request.translation ? nativeLanguages.find(l => l.languageCode === request.translation) : undefined;
          if (track && state.languageSupported) {
            // Pass only a track supplied by this exact native player. Never
            // accept a caller-provided track object, URL or arbitrary option.
            if (request.translation && (!translation || track.isTranslateable === false)) state.error = "That translation is unavailable for this subtitle track.";
            else {
              player.setOption!("captions", "track", translation ? { ...track, translationLanguage: translation } : track);
              state.enabled = Boolean(player.isSubtitlesOn());
            }
          } else state.error = "That subtitle language is no longer available.";
        }
        if (typeof request.enabled === "boolean" && state.nativeSupported && state.available && request.enabled !== state.enabled) {
          if (player.toggleSubtitles) player.toggleSubtitles();
          else if (request.enabled) player.toggleSubtitlesOn!();
          else player.setOption!("captions", "track", {});
          state.enabled = Boolean(player.isSubtitlesOn());
        }
        const selected = player.getOption?.("captions", "track") as NativeTrack | undefined;
        if (selected?.languageCode) {
          const exact = state.tracks.find(t => t.id === trackId(selected));
          state.selectedTrack = exact?.id ?? state.tracks.find(t => t.languageCode === selected.languageCode)?.id ?? "";
          state.translation = selected.translationLanguage?.languageCode ?? "";
        }
      }
    } catch { state.error = "YouTube could not update subtitles. Try again."; }
    video.dispatchEvent(new CustomEvent(captionResponseEvent, { detail: JSON.stringify(state) }));
  }, true);
})();
