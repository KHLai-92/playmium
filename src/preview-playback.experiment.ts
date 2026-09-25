import { createPlaylistPlaybackRestorer } from "./preview-playlist-playback";
/** EXPERIMENT: one complete non-native preview interface for playlist and
 * thumbnail callers. Start from 72bfe80's playback rules; do not tune broker
 * scheduling to make the experiment pass. No player means create an extension
 * player, never lease a global YouTube hover player into a second lifetime. */
import { cancelPlaylistPreviewResponse, playlistPreviewResponse, primePlaylistPreviewResponse,
  releasePlaylistPreviewResponse, setPlaylistPreviewRetentionCapacity } from "./preview-playlist-broker-top.main";
import { playlistAudioChangeEvent, validatedPlaylistPlayerResponse,
  type PlaylistBrokerTimeoutMultipliers, type PlaylistPreviewTrigger } from "./preview-playlist";
import { preferredQuality } from "./preview-window";
import { qualityLabels } from "./preview-quality";
import { emitPreviewDebugLog } from "./preview-debug-log";

export type PreviewPlaybackRequest = Readonly<{ videoId: string; requestId: string; actionId: string;
  startedAtMs?: number; quality?: string; retentionCapacity?: number; retryLimit?: number;
  timeoutMultipliers?: PlaylistBrokerTimeoutMultipliers; rect?: { left: number; top: number; width: number; height: number } }>;
export type PreviewPlaybackPhase = { phase: "commit" | "playing" | "success"; source?: string;
  quality?: string; responseSource: "broker" };
export type PreviewPlaybackResult = { phase: "ready" | "error"; source: string; error: string; started: boolean;
  layer: string; stage: string; retryable: boolean; responseSource: "broker" };
type Api = { getVideoData?: () => { video_id?: string }; isMuted?: () => boolean; mute?: () => void; unMute?: () => void;
  getVolume?: () => number; setVolume?: (value: number) => void; getPlaybackRate?: () => number; setPlaybackRate?: (value: number) => void;
  getAvailableQualityLevels?: () => string[]; getPlaybackQuality?: () => string; setPlaybackQualityRange?: (min: string, max: string) => void;
  playVideo?: () => void; pauseVideo?: () => void; stopVideo?: () => void; destroy?: () => void };
type Player = HTMLElement & { playerId?: string; context?: string; disableTouchGestures?: boolean;
  loadVideoWithPlayerResponse?: (response: unknown, vars?: Record<string, unknown>) => void;
  getPlayer?: () => Api | Promise<Api>; getPlayerPromise?: () => Promise<Api>; stop?: () => void };
type Resource = { wrapper: Player; api?: Api; events: AbortController; observer: MutationObserver; disposed: boolean };
const resources = new WeakMap<HTMLElement, Resource>();
const jobs = new WeakMap<HTMLElement, AbortController>();
const audioChanges = new WeakMap<HTMLVideoElement, number>();
const newPlayerStartupSafetyTimeoutMs = 5000;
let sequence = 0;

export function preparePreview(target: HTMLElement, videoId: string,
    intent: { actionId: string; trigger: PlaylistPreviewTrigger; startedAtMs?: number; retentionCapacity?: number;
      retryLimit?: number; timeoutMultipliers?: PlaylistBrokerTimeoutMultipliers; surface?: "playlist" | "thumbnail";
      rect?: { left: number; top: number; width: number; height: number } }) {
  const rect = intent.rect ?? target.getBoundingClientRect();
  return primePlaylistPreviewResponse(target, videoId, rect, intent);
}
export const cancelPreviewPreparation = cancelPlaylistPreviewResponse;
export const setPreviewRetentionCapacity = setPlaylistPreviewRetentionCapacity;

function stopResource(host: HTMLElement, resource: Resource) {
  if (resource.disposed) return;
  resource.disposed = true;
  resource.events.abort(); resource.observer.disconnect();
  for (const release of [() => resource.wrapper.stop?.(), () => resource.api?.stopVideo?.(), () => resource.api?.destroy?.()]) {
    try { release(); } catch { /* Every release operation still gets a chance. */ }
  }
  for (const media of resource.wrapper.querySelectorAll<HTMLMediaElement>("video,audio")) {
    try { media.pause(); media.removeAttribute("src"); media.srcObject = null; media.load(); } catch { /* Release the other nodes too. */ }
  }
  resource.wrapper.remove();
  if (resources.get(host) === resource) resources.delete(host);
}
export function stopPreview(host: HTMLElement) {
  jobs.get(host)?.abort(new DOMException("Preview closed.", "AbortError"));
  jobs.delete(host);
  const resource = resources.get(host);
  if (resource) stopResource(host, resource);
  delete host.dataset.skipPreviewOwnedReady;
}
function playerFor(video: HTMLVideoElement, host: HTMLElement): Player | null {
  for (let item: Player | null = video.parentElement; item && host.contains(item); item = item.parentElement) {
    if (item.loadVideoWithPlayerResponse && (item.getPlayer || item.getPlayerPromise)) return item;
    if (item === host) break;
  }
  return null;
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    promise.then(value => { signal.removeEventListener("abort", abort); resolve(value); },
      error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}

/** Callers provide the floating container and video identity. This module owns
 * preparation, player selection/creation, load, first frame and release. */
export async function previewVideo(host: HTMLElement, request: PreviewPlaybackRequest,
    options: { signal?: AbortSignal; onPhase?: (phase: PreviewPlaybackPhase) => void } = {}): Promise<PreviewPlaybackResult> {
  jobs.get(host)?.abort(new DOMException("Preview replaced.", "AbortError"));
  const controller = new AbortController(); jobs.set(host, controller);
  const signal = controller.signal;
  const cancel = () => controller.abort(options.signal?.reason ?? new DOMException("Preview closed.", "AbortError"));
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  let video = host.querySelector<HTMLVideoElement>("video.skip-ads-preview-prototype-video");
  let player = video ? playerFor(video, host) : null;
  const existingPlayer = !!video && !!player;
  const previousSource = video?.currentSrc ?? "";
  let api: Api | undefined, allocated: Resource | undefined;
  let layer = "playlist-main", started = false, timer: ReturnType<typeof setTimeout> | undefined;
  const began = performance.now();
  const current = () => !signal.aborted && jobs.get(host) === controller && host.isConnected;
  const check = () => { if (!current()) throw signal.reason ?? new DOMException("Preview replaced.", "AbortError"); };
  const trace = (event: string, extra: Record<string, unknown> = {}) => emitPreviewDebugLog(event, {
    surface: existingPlayer ? "playlist" : "thumbnail", actionId: request.actionId, videoId: request.videoId,
    selectionRequestId: request.requestId, layer, existingPlayer,
    actionElapsedMs: Math.round((performance.now() - (request.startedAtMs ?? began)) * 10) / 10,
    selectionElapsedMs: Math.round((performance.now() - began) * 10) / 10, ...extra,
  });
  const observer = new MutationObserver(() => { if (!host.isConnected) cancel(); });
  observer.observe(host.ownerDocument, { childList: true, subtree: true });
  const cancelWork = () => cancelPreviewPreparation(request.videoId, request.actionId, "playback-cancelled");
  signal.addEventListener("abort", cancelWork, { once: true });
  try {
    check(); trace("preview.select-request");
    layer = "player-api";
    if (existingPlayer) {
      api = await abortable(Promise.resolve(player!.getPlayer ? player!.getPlayer() : player!.getPlayerPromise!()), signal);
      check(); trace("preview.select-player-api-ready");
      if (video!.currentSrc !== previousSource) throw new Error("The preview stream changed before playback started.");
    }
    layer = "broker-top";
    const owner = video ?? host;
    const warm = playlistPreviewResponse(request.videoId, request.actionId, { target: owner, signal });
    const bounds = request.rect ?? host.getBoundingClientRect();
    const pending = warm ?? primePlaylistPreviewResponse(owner, request.videoId, {
      left: bounds.left, top: bounds.top, width: Math.max(24, bounds.width), height: Math.max(24, bounds.height),
    }, { actionId: request.actionId, startedAtMs: request.startedAtMs, trigger: "click", signal,
      surface: existingPlayer ? "playlist" : "thumbnail", retentionCapacity: request.retentionCapacity,
      retryLimit: request.retryLimit, timeoutMultipliers: request.timeoutMultipliers });
    if (!pending) throw new Error("The extension could not start preview preparation.");
    if (!warm) playlistPreviewResponse(request.videoId, request.actionId, { target: owner, signal });
    trace("preview.select-await-broker", { reusedPreparation: !!warm });
    const supplied = await abortable(pending, signal);
    releasePlaylistPreviewResponse(request.videoId);
    check(); trace("preview.select-broker-response");
    if (existingPlayer && video!.currentSrc !== previousSource) throw new Error("The preview stream changed before the selection was ready.");
    layer = "response-validation";
    const response = validatedPlaylistPlayerResponse(supplied, request.videoId);
    if (!response) throw new Error("Preview playback is unavailable for this video.");
    trace("preview.select-response-valid");
    if (!existingPlayer) {
      // This internal safety limit starts only after the preview data is ready.
      // Native previews use their separate, user-configurable startup policy.
      timer = setTimeout(() => controller.abort(new Error(`YouTube preview ${layer} timed out.`)), newPlayerStartupSafetyTimeoutMs);
      layer = "player-definition";
      await abortable(host.ownerDocument.defaultView!.customElements.whenDefined("ytd-player"), signal); check();
      player = host.ownerDocument.createElement("ytd-player") as Player;
      player.id = "skip-preview-owned-native-player";
      player.playerId = `skip-preview-shared-${++sequence}`;
      player.context = "WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_INLINE_PREVIEW";
      player.setAttribute("player-id", player.playerId); player.setAttribute("context", player.context);
      player.disableTouchGestures = true;
      player.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      const resourceObserver = new MutationObserver(() => { if (!host.isConnected && allocated) stopResource(host, allocated); });
      allocated = { wrapper: player, events: new AbortController(), observer: resourceObserver, disposed: false };
      resources.set(host, allocated); resourceObserver.observe(host.ownerDocument, { childList: true, subtree: true });
      window.addEventListener("pagehide", () => stopPreview(host), { once: true, signal: allocated.events.signal });
      host.append(player);
      layer = "player-api";
      while (!player.loadVideoWithPlayerResponse || !player.getPlayerPromise) { await delay(40, signal); check(); }
    }
    trace("preview.shared-player", { created: !existingPlayer, playerRootId: player?.playerId ?? player?.id });
    const initialAvailable = api?.getAvailableQualityLevels?.() ?? [];
    const initialQuality = request.quality && request.quality !== "auto" && initialAvailable.includes(request.quality) ? request.quality : preferredQuality(initialAvailable);
    const audioVersion = video ? audioChanges.get(video) ?? 0 : 0;
    const playback = existingPlayer ? createPlaylistPlaybackRestorer(api ?? {}, video!, {
      isCurrent: current,
      audioUnchanged: () => (audioChanges.get(video!) ?? 0) === audioVersion,
    }) : undefined;
    layer = "player-commit";
    options.onPhase?.({ phase: "commit", responseSource: "broker" }); check();
    if (existingPlayer && video!.dataset.skipPreviewPlaylistRequest !== request.requestId)
      throw new Error("The preview session changed before playback started.");
    if (initialQuality && api?.setPlaybackQualityRange) api.setPlaybackQualityRange(initialQuality, initialQuality);
    playback?.listen();
    player!.loadVideoWithPlayerResponse!(response, existingPlayer ? undefined : { autoplay: "1", mute: "1" });
    started = true; trace("preview.select-player-commit");
    if (!existingPlayer) {
      const resource = allocated!;
      const apiPromise = player!.getPlayerPromise!().then(value => {
        if (resource.disposed) {
          try { value.stopVideo?.(); } catch {}
          try { value.destroy?.(); } catch {}
        }
        else resource.api = value;
        return value;
      });
      api = await abortable(apiPromise, signal); check(); api.mute?.(); api.playVideo?.();
    }
    if (!existingPlayer) layer = "youtube-media";
    const deadline = performance.now() + 20000; // exact stable existing-player first-frame limit
    while (!video || api?.getVideoData?.().video_id !== request.videoId || video.currentSrc === previousSource || video.readyState < 2) {
      check();
      if (existingPlayer && performance.now() >= deadline) throw new Error("YouTube did not finish loading the selected preview.");
      await delay(existingPlayer ? 100 : 40, signal);
      video = player!.querySelector<HTMLVideoElement>("video");
    }
    check(); layer = "youtube-media"; trace("preview.select-first-frame", { readyState: video.readyState });
    if (!existingPlayer) {
      api?.pauseVideo?.(); video.pause(); host.dataset.skipPreviewOwnedReady = request.videoId;
      return { phase: "ready", source: video.currentSrc, error: "", started, layer, stage: layer, retryable: false, responseSource: "broker" };
    }
    if (host.hasAttribute("data-skip-preview-owned")) {
      host.dataset.skipPreviewOwned = request.videoId; host.dataset.skipPreviewOwnedReady = request.videoId;
    }
    options.onPhase?.({ phase: "playing", source: video.currentSrc, quality: api?.getPlaybackQuality?.() ?? "auto", responseSource: "broker" });
    const available = api?.getAvailableQualityLevels?.() ?? [];
    const quality = request.quality && request.quality !== "auto" && available.includes(request.quality) ? request.quality : preferredQuality(available);
    if (quality && api?.setPlaybackQualityRange && api.getPlaybackQuality?.() !== quality) api.setPlaybackQualityRange(quality, quality);
    playback?.restore();
    const settleDeadline = performance.now() + 10000;
    while (quality && performance.now() < settleDeadline && (api?.getVideoData?.().video_id !== request.videoId || video.readyState < 2 || api?.getPlaybackQuality?.() !== quality)) {
      check(); await delay(100, signal);
    }
    if (quality && api?.getPlaybackQuality?.() !== quality) throw new Error(`YouTube did not finish switching to ${qualityLabels[quality]}.`);
    playback?.restore(); trace("preview.select-success", { quality: quality ?? "auto" });
    options.onPhase?.({ phase: "success", source: video.currentSrc, quality: quality ?? "auto", responseSource: "broker" });
    playback?.retainAudio();
    return { phase: "ready", source: video.currentSrc, error: "", started, layer, stage: layer, retryable: false, responseSource: "broker" };
  } catch (error) {
    if (allocated) stopResource(host, allocated);
    trace("preview.select-error", { reason: error instanceof Error ? error.message : String(error), started });
    if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === "AbortError") throw error;
    return { phase: "error", source: "", error: (error instanceof Error ? error.message : String(error)).slice(0, 300), started,
      layer, stage: layer, retryable: layer !== "broker-top" && layer !== "response-validation", responseSource: "broker" };
  } finally {
    clearTimeout(timer); observer.disconnect(); options.signal?.removeEventListener("abort", cancel);
  }
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener(playlistAudioChangeEvent, event => {
    if (event.target instanceof HTMLVideoElement) audioChanges.set(event.target, (audioChanges.get(event.target) ?? 0) + 1);
  }, true);
}
