/** Event authorization/presentation adapter. All playback lives in previewVideo. */
import { sharedPreviewPrepareEvent, sharedPreviewCancelEvent, sharedPreviewStartEvent, sharedPreviewResultEvent,
  type SharedPreviewRequest } from "./preview-playback-experiment-events";
import { preparePreview, previewVideo, cancelPreviewPreparation, stopPreview } from "./preview-playback.experiment";
import { previewPlaybackSupport, resolvePreviewHost, resolvePreviewThumbnail } from "./preview-entry";
import { playlistPreviewWarmPhaseEvent } from "./preview-playlist";

function valid(value: unknown): value is SharedPreviewRequest {
  const r = value as Partial<SharedPreviewRequest> | null;
  return !!r && typeof r.videoId === "string" && /^[\w-]{11}$/.test(r.videoId) && typeof r.requestId === "string" &&
    r.requestId.length > 0 && r.requestId.length <= 100 && typeof r.timeoutMs === "number" && r.timeoutMs >= 2000 && r.timeoutMs <= 15000 &&
    (r.actionId === undefined || typeof r.actionId === "string" && r.actionId.length > 0 && r.actionId.length <= 100) &&
    (r.retryLimit === undefined || Number.isInteger(r.retryLimit) && r.retryLimit >= 0 && r.retryLimit <= 3);
}
export function installSharedPreviewExperiment() {
  if (window !== window.top) return;
  const requests = new WeakMap<HTMLElement, AbortController>();
  document.addEventListener(sharedPreviewPrepareEvent, event => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.isConnected) return;
    let request: SharedPreviewRequest & { trigger?: "hover" | "focus" };
    try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
    const entry = resolvePreviewThumbnail(target, location.href);
    if (!valid(request) || !entry || entry.videoId !== request.videoId || !["hover", "focus"].includes(request.trigger ?? "")) return;
    if (previewPlaybackSupport(target, request.videoId, location.pathname).native) {
      target.dispatchEvent(new CustomEvent(playlistPreviewWarmPhaseEvent, { detail: JSON.stringify({ actionId: request.requestId,
        videoId: request.videoId, phase: "idle" }) })); return;
    }
    void preparePreview(target, request.videoId, { ...request, actionId: request.requestId, trigger: request.trigger!, surface: "thumbnail" })?.catch(() => {});
  }, true);
  document.addEventListener(sharedPreviewCancelEvent, event => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (resolvePreviewHost(target) === target) {
      requests.get(target)?.abort(); requests.delete(target); stopPreview(target); return;
    }
    let request: unknown;
    try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
    if (valid(request)) cancelPreviewPreparation(request.videoId, request.requestId, "thumbnail-intent-ended");
  }, true);
  document.addEventListener(sharedPreviewStartEvent, event => {
    const host = event.target;
    if (!(host instanceof HTMLElement) || !host.isConnected || !host.hasAttribute("data-skip-preview-owned")) return;
    let request: unknown;
    try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
    if (!valid(request) || host.dataset.skipPreviewOwned !== request.videoId) return;
    requests.get(host)?.abort();
    const controller = new AbortController(); requests.set(host, controller);
    const publish = (result: Record<string, unknown>) => {
      if (controller.signal.aborted || !host.isConnected || requests.get(host) !== controller) return;
      host.dispatchEvent(new CustomEvent(sharedPreviewResultEvent, { detail: JSON.stringify({ ...request, ...result }) }));
    };
    void previewVideo(host, { ...request, actionId: request.actionId ?? request.requestId }, {
      signal: controller.signal, onPhase(phase) {
        if (phase.phase === "commit") {
          const video = host.querySelector<HTMLVideoElement>("video.skip-ads-preview-prototype-video");
          if (video) video.dataset.skipPreviewPlaylistRequest = request.requestId;
        }
        // Stable playlist playback presents the first frame before quality
        // settlement finishes. Reused thumbnail players present at that seam too.
        if (phase.phase === "playing") publish({ ...phase, phase: "ready", error: "", retryable: false });
      },
    }).then(result => {
      if (controller.signal.aborted || !host.isConnected || requests.get(host) !== controller) return;
      publish(result);
    }, () => { /* Cancelled work cannot publish into a replacement. */ });
  }, true);
}
