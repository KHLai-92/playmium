import { normalizePlaylistBrokerTimeoutMultipliers, normalizePlaylistPreviewRetentionCapacity, normalizePlaylistStageRetryLimit,
  playlistBrokerClickEvent, playlistBrokerStageTimeoutMs, playlistPreviewRetentionCapacity, playlistPreviewRetentionTtlMs,
  playlistPreviewWarmPhaseEvent, type PlaylistBrokerTimeoutMultipliers, type PlaylistPreviewTrigger } from "./preview-playlist";
import {
  isPlaylistBrokerResponse,
  isPlaylistBrokerVideoId,
  playlistBrokerChannel,
  playlistBrokerRequestParameter,
  playlistBrokerSearchQuery,
  playlistBrokerSearchModeParameter,
  playlistBrokerVideoParameter,
  type PlaylistBrokerMessage,
  type PlaylistBrokerRect,
} from "./preview-playlist-broker-schema";
import { resolvePreviewThumbnail } from "./preview-entry";
import { emitPreviewDebugLog } from "./preview-debug-log";
import { previewSearchModeEvent } from "./preview-search-preference";

type BrokerProgress = "starting" | "ready" | "request";
type BrokerRetryScope = "broker-document" | "native-hover";

type PendingBroker = {
  video: WeakRef<HTMLElement>;
  surface?: "playlist" | "thumbnail";
  videoId: string;
  actionId: string;
  trigger: PlaylistPreviewTrigger;
  requestId: string;
  rect: PlaylistBrokerRect;
  promise: Promise<unknown>;
  resolve: (response: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
  attempt: number;
  retryLimit: number;
  timeoutMultipliers: PlaylistBrokerTimeoutMultipliers;
  stageRetries: Record<BrokerProgress, number>;
  selected: boolean;
  progress: BrokerProgress;
  events: AbortController;
  ownerSignal?: AbortSignal;
  startedAt: number;
  attemptStartedAt: number;
};

type ReadyBroker = {
  video: WeakRef<HTMLElement>;
  surface?: "playlist" | "thumbnail";
  videoId: string;
  actionId: string;
  trigger: PlaylistPreviewTrigger;
  response: unknown;
  timeout: number;
};

let active: PendingBroker | null = null;
let brokerFrame: HTMLIFrameElement | null = null;
let brokerFrameOnline = false;
let brokerFrameInitialRequestId = "";
let brokerFrameInitialVideoId = "";
let brokerFrameConsumedVideoIds = new Set<string>();
let brokerFrameFailedVideoIds = new Set<string>();
let readyResponses = new Map<string, ReadyBroker>();
let readyCapacity = playlistPreviewRetentionCapacity;
let installed = false;
let useUrlSearch = false;
let brokerFrameUsesUrlSearch = false;

function onSearchMode(event: Event) {
  if (!(event instanceof CustomEvent) || typeof event.detail !== "string") return;
  try {
    const enabled = JSON.parse(event.detail);
    if (typeof enabled === "boolean" && enabled !== useUrlSearch) {
      useUrlSearch = enabled;
      for (const entry of [...readyResponses.values()]) releaseReady(entry, "released");
    }
  } catch { /* Ignore malformed cross-world settings. */ }
}

function elapsed(startedAt: number) {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}
function trace(session: PendingBroker, event: string, detail: Record<string, unknown> = {}) {
  emitPreviewDebugLog(event, {
    surface: session.surface ?? "playlist", layer: "broker-top", actionId: session.actionId, trigger: session.trigger,
    videoId: session.videoId, brokerRequestId: session.requestId, attempt: session.attempt,
    actionElapsedMs: elapsed(session.startedAt), attemptElapsedMs: elapsed(session.attemptStartedAt), ...detail,
  });
}
function emitPhase(video: HTMLElement, session: Pick<PendingBroker, "actionId" | "trigger" | "videoId" | "surface">,
    value: "idle" | "preparing" | "ready" | "error", error = "") {
  video.dispatchEvent(new CustomEvent(playlistPreviewWarmPhaseEvent, { detail: JSON.stringify({
    actionId: session.actionId, trigger: session.trigger, videoId: session.videoId, phase: value, error,
  }) }));
}
function phase(session: Pick<PendingBroker, "video" | "actionId" | "trigger" | "videoId" | "surface">,
    value: "idle" | "preparing" | "ready" | "error", error = "") {
  const video = session.video.deref();
  if (video) emitPhase(video, session, value, error);
}

function releaseReady(entry: ReadyBroker, reason: "selected" | "expired" | "capacity" | "cancelled" | "released") {
  if (readyResponses.get(entry.videoId) !== entry) return false;
  readyResponses.delete(entry.videoId);
  clearTimeout(entry.timeout);
  phase(entry, "idle");
  emitPreviewDebugLog(reason === "expired" ? "resource.expire" : reason === "capacity" ? "resource.evict" :
    reason === "selected" ? "resource.hit" : "resource.release", {
    surface: entry.surface ?? "playlist", resource: "playlist-preview-response", key: entry.videoId,
    actionId: entry.actionId, layer: "broker-top", reason,
  });
  return true;
}

function trimReadyResponses() {
  while (readyResponses.size > readyCapacity) {
    const oldest = readyResponses.values().next().value as ReadyBroker | undefined;
    if (!oldest) break;
    releaseReady(oldest, "capacity");
  }
}

export function setPlaylistPreviewRetentionCapacity(value: unknown) {
  readyCapacity = normalizePlaylistPreviewRetentionCapacity(value);
  trimReadyResponses();
  return readyCapacity;
}

function retainReadyResponse(session: PendingBroker, response: unknown) {
  if (brokerFrameUsesUrlSearch !== useUrlSearch) { phase(session, "idle"); return; }
  const existing = readyResponses.get(session.videoId);
  if (existing) releaseReady(existing, "released");
  const entry: ReadyBroker = {
    video: session.video, surface: session.surface, videoId: session.videoId, actionId: session.actionId, trigger: session.trigger,
    response, timeout: 0,
  };
  entry.timeout = window.setTimeout(() => releaseReady(entry, "expired"), playlistPreviewRetentionTtlMs);
  readyResponses.set(entry.videoId, entry);
  emitPreviewDebugLog("resource.create", {
    surface: session.surface ?? "playlist", resource: "playlist-preview-response", key: entry.videoId,
    actionId: entry.actionId, layer: "broker-top", capacity: readyCapacity,
  });
  trimReadyResponses();
  if (readyResponses.get(entry.videoId) === entry) phase(entry, "ready");
}
function finish(session: PendingBroker) {
  clearTimeout(session.timeout);
  session.events.abort();
  if (active === session) active = null;
}
function cancel(session: PendingBroker, reason: string) {
  if (active !== session) return false;
  trace(session, "preview.prepare-cancel", { reason });
  brokerFrame?.contentWindow?.postMessage({
    channel: playlistBrokerChannel, kind: "cancel", requestId: session.requestId, videoId: session.videoId,
  }, location.origin);
  session.reject(new Error(`Playlist preview preparation was superseded: ${reason}.`));
  phase(session, "idle");
  finish(session);
  return true;
}
function brokerFrameSource(session: PendingBroker) {
  const mode = useUrlSearch ? `&${playlistBrokerSearchModeParameter}=url` : "";
  return `/results?search_query=${encodeURIComponent(playlistBrokerSearchQuery(session.videoId, "", useUrlSearch))}&${playlistBrokerRequestParameter}=${encodeURIComponent(session.requestId)}&${playlistBrokerVideoParameter}=${encodeURIComponent(session.videoId)}${mode}`;
}
function createFrame(session: PendingBroker) {
  brokerFrameUsesUrlSearch = useUrlSearch;
  document.documentElement.dataset.skipPreviewBrokerSearch = useUrlSearch ? "url" : "id";
  const iframe = document.createElement("iframe");
  iframe.className = "skip-ads-preview-playlist-broker";
  iframe.dataset.videoId = session.videoId;
  iframe.title = "";
  iframe.tabIndex = -1;
  iframe.setAttribute("aria-hidden", "true");
  iframe.src = brokerFrameSource(session);
  Object.assign(iframe.style, {
    position: "fixed",
    left: `${Math.round(session.rect.left)}px`,
    top: `${Math.round(session.rect.top)}px`,
    width: `${Math.max(24, Math.round(session.rect.width))}px`,
    height: `${Math.max(24, Math.round(session.rect.height))}px`,
    opacity: "0.01",
    border: "0",
    margin: "0",
    padding: "0",
    // Keep the transparent broker below every interactive preview layer. When
    // it shared the playlist's maximum z-index, inserting it during preparing
    // could invalidate the compositor's wheel target and latch the gesture to
    // the YouTube page behind the drawer.
    zIndex: "2147483644",
    pointerEvents: "none",
  });
  return iframe;
}
function positionFrame(iframe: HTMLIFrameElement, session: PendingBroker) {
  iframe.dataset.videoId = session.videoId;
  iframe.style.left = `${Math.round(session.rect.left)}px`;
  iframe.style.top = `${Math.round(session.rect.top)}px`;
  iframe.style.width = `${Math.max(24, Math.round(session.rect.width))}px`;
  iframe.style.height = `${Math.max(24, Math.round(session.rect.height))}px`;
}
function releaseFrame(reason: string) {
  if (!brokerFrame) return;
  emitPreviewDebugLog("resource.release", {
    resource: "playlist-broker-frame", key: brokerFrame.dataset.videoId ?? "", reason,
  });
  brokerFrame.remove();
  brokerFrame = null;
  brokerFrameOnline = false;
  brokerFrameInitialRequestId = "";
  brokerFrameInitialVideoId = "";
  brokerFrameConsumedVideoIds = new Set<string>();
  brokerFrameFailedVideoIds = new Set<string>();
}
function postPrepare(session: PendingBroker) {
  trace(session, "preview.broker-command", { command: "prepare", brokerOnline: brokerFrameOnline });
  brokerFrame?.contentWindow?.postMessage({
    channel: playlistBrokerChannel, kind: "prepare", requestId: session.requestId, videoId: session.videoId,
  }, location.origin);
}
function postRewake(session: PendingBroker) {
  trace(session, "preview.broker-command", { command: "rewake", brokerOnline: brokerFrameOnline });
  brokerFrame?.contentWindow?.postMessage({
    channel: playlistBrokerChannel, kind: "rewake", requestId: session.requestId, videoId: session.videoId,
  }, location.origin);
}
function retryScope(session: PendingBroker, progress = session.progress): BrokerRetryScope {
  return progress === "ready" && brokerFrameOnline ? "native-hover" : "broker-document";
}
function canRetry(session: PendingBroker, progress = session.progress) {
  return session.stageRetries[progress] < session.retryLimit;
}
function failOrRetry(session: PendingBroker, error: Error) {
  if (active !== session) return;
  const failedProgress = session.progress;
  if (canRetry(session, failedProgress)) {
    session.stageRetries[failedProgress]++;
    session.attempt++;
    clearTimeout(session.timeout);
    const scope = retryScope(session, failedProgress);
    if (scope === "native-hover") {
      session.progress = "starting";
      emitPreviewDebugLog("resource.retry", {
        resource: "playlist-broker-frame", key: session.videoId, actionId: session.actionId,
        layer: "broker-top", attempt: session.attempt, progress: failedProgress,
        stageRetry: session.stageRetries[failedProgress], scope, reason: "rewake",
      });
      session.attemptStartedAt = performance.now();
      postRewake(session);
      armAttemptTimeout(session);
      return;
    }
    emitPreviewDebugLog("resource.retry", {
      resource: "playlist-broker-frame", key: session.videoId, actionId: session.actionId,
      layer: "broker-top", attempt: session.attempt, progress: failedProgress,
      stageRetry: session.stageRetries[failedProgress], scope, reason: `${failedProgress}-failure`,
    });
    releaseFrame(`${failedProgress}-failure`);
    active = null;
    start(session);
    return;
  }
  trace(session, "preview.prepare-error", {
    layer: session.progress === "request" ? "youtube-player-response" : "youtube-renderer",
    progress: session.progress, reason: error.message,
  });
  // A final failure can leave YouTube's same-video search renderer unable to
  // emit another native player response. Do not route Try again back into that
  // poisoned document; another video used to clear this state only by causing
  // an incidental SPA navigation.
  brokerFrameFailedVideoIds.add(session.videoId);
  // Terminal top rejection otherwise leaves the resident native hover job
  // playing with no owner able to cancel it. Retire work, keep the iframe.
  brokerFrame?.contentWindow?.postMessage({
    channel: playlistBrokerChannel, kind: "cancel", requestId: session.requestId, videoId: session.videoId,
  }, location.origin);
  session.reject(error);
  phase(session, "error", "Native preview unavailable.");
  finish(session);
}
function armAttemptTimeout(session: PendingBroker) {
  clearTimeout(session.timeout);
  const progress = session.progress;
  const timeout = playlistBrokerStageTimeoutMs(progress, session.timeoutMultipliers);
  session.timeout = window.setTimeout(() => {
    const willRetry = canRetry(session, progress);
    trace(session, "preview.prepare-timeout", {
      progress, timeoutMs: timeout, stageAttempt: session.stageRetries[progress] + 1, willRetry,
      retryScope: willRetry ? retryScope(session, progress) : "none",
    });
    failOrRetry(session, new Error("YouTube's native hover preview timed out. Try again."));
  }, timeout);
}
function prioritize(session: PendingBroker) {
  session.selected = true;
  session.trigger = "click";
  trace(session, "preview.prepare-prioritize", { progress: session.progress });
  if (active === session) {
    // A click upgrades this exact action but does not imply that a renderer which
    // just became ready has stalled. Preserve its current attempt and start the
    // phase-specific watchdog from the click; recovery happens only on timeout.
    armAttemptTimeout(session);
    return;
  }
}
function start(session: PendingBroker) {
  const video = session.video.deref();
  if (!video?.isConnected || !(video.classList.contains("skip-ads-preview-prototype-video") || video.hasAttribute?.("data-skip-preview-owned") ||
      session.surface === "thumbnail" && resolvePreviewThumbnail(video, location.href)?.videoId === session.videoId)) {
    session.reject(new Error("The preview session ended before this item was prepared."));
    phase(session, "error", "Preview session ended.");
    finish(session);
    return;
  }
  session.requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  session.progress = "starting";
  session.attemptStartedAt = performance.now();
  active = session;
  trace(session, "preview.prepare-start", { brokerResident: Boolean(brokerFrame?.isConnected), retryLimit: session.retryLimit,
    timeoutMultipliers: session.timeoutMultipliers });
  armAttemptTimeout(session);
  if (!brokerFrame?.isConnected) {
    brokerFrame = createFrame(session);
    brokerFrameOnline = false;
    brokerFrameInitialRequestId = session.requestId;
    brokerFrameInitialVideoId = session.videoId;
    document.documentElement.append(brokerFrame);
    emitPreviewDebugLog("resource.create", { resource: "playlist-broker-frame", key: session.videoId,
      actionId: session.actionId, layer: "broker-top" });
  } else {
    positionFrame(brokerFrame, session);
    emitPreviewDebugLog("resource.hit", { resource: "playlist-broker-frame", key: session.videoId,
      actionId: session.actionId, layer: "broker-top" });
    if (brokerFrameOnline) postPrepare(session);
    else {
      // A newer hover can take ownership while a replacement document is still
      // loading. Restart that same iframe with the latest request in its URL;
      // sending an SPA command into a half-initialized YouTube page is lossy.
      brokerFrameInitialRequestId = session.requestId;
      brokerFrameInitialVideoId = session.videoId;
      brokerFrame.src = brokerFrameSource(session);
      emitPreviewDebugLog("resource.refresh", {
        surface: session.surface ?? "playlist", resource: "playlist-broker-frame", key: session.videoId,
        actionId: session.actionId, trigger: session.trigger, layer: "broker-top",
        reason: "superseded-before-online",
      });
    }
  }
}

const onBrokerMessage = (event: MessageEvent) => {
  const message = event.data as PlaylistBrokerMessage;
  if (!brokerFrame || event.origin !== location.origin || event.source !== brokerFrame.contentWindow) return;
  if (message?.channel === playlistBrokerChannel && message.kind === "online") {
    if (brokerFrameOnline) return;
    brokerFrameOnline = true;
    if (active) trace(active, "preview.broker-online", {
      initialRequest: active.requestId === brokerFrameInitialRequestId,
    });
    if (!active || active.requestId !== brokerFrameInitialRequestId) {
      brokerFrame.contentWindow?.postMessage({ channel: playlistBrokerChannel, kind: "cancel",
        requestId: brokerFrameInitialRequestId, videoId: brokerFrameInitialVideoId }, location.origin);
      if (active) postPrepare(active);
    }
    return;
  }
  const session = active;
  if (!session) return;
  if (!isPlaylistBrokerResponse(message, session.requestId, session.videoId)) {
    if (message?.channel === playlistBrokerChannel && ["ready", "request", "request-observed", "click", "response", "invalid", "error"].includes(String(message.kind))) {
      trace(session, "preview.broker-message-ignored", {
        receivedKind: String(message.kind), receivedRequestId: String(message.requestId ?? "").slice(0, 100),
        receivedVideoId: String(message.videoId ?? "").slice(0, 32), reason: "stale-or-mismatched-identity",
      });
    }
    return;
  }
  document.documentElement.dataset.skipPreviewBrokerLast = `${String(message.kind)}:${session.videoId}`;
  if (message.kind === "invalid") {
    trace(session, "preview.broker-invalid-response", {
      layer: "youtube-player-response",
      reason: typeof message.reason === "string" ? message.reason.slice(0, 40) : "unknown",
      observedVideoId: typeof message.observedVideoId === "string" ? message.observedVideoId.slice(0, 32) : "",
      playabilityStatus: typeof message.playabilityStatus === "string" ? message.playabilityStatus.slice(0, 40) : "",
      hasStreamingData: message.hasStreamingData === true,
      frameElapsedMs: typeof message.elapsedMs === "number" ? message.elapsedMs : undefined,
    });
    return;
  }
  if (message.kind === "request-observed") {
    // v86-compatible timing only; strict request ownership still controls the
    // watchdog, hover wake cancellation and physical network cancellation.
    trace(session, "preview.broker-progress", {
      phase: "player-request", layer: "youtube-player-request",
      frameElapsedMs: typeof message.elapsedMs === "number" ? message.elapsedMs : undefined,
    });
    return;
  }
  if (message.kind === "ready" || message.kind === "request") {
    if (message.kind === "ready") trace(session, "preview.broker-progress", {
      phase: "renderer-ready", layer: "youtube-renderer",
      frameElapsedMs: typeof message.elapsedMs === "number" ? message.elapsedMs : undefined,
    });
    if (session.progress === "request" || session.progress === message.kind) return;
    // Progress resets the fallback watchdog so a renderer that is advancing is
    // not retried while YouTube is legitimately preparing its player response.
    session.progress = message.kind;
    armAttemptTimeout(session);
    return;
  }
  if (message.kind === "click") {
    session.video.deref()?.dispatchEvent(new CustomEvent(playlistBrokerClickEvent, { detail: JSON.stringify({
      actionId: session.actionId, videoId: session.videoId,
    }) }));
    return;
  }
  if (message.kind === "response") {
    const video = session.video.deref();
    if (!video?.isConnected) {
      session.reject(new Error("The preview session ended before this item was prepared."));
      finish(session);
      return;
    }
    const retained = !session.selected && session.trigger !== "click";
    trace(session, "preview.broker-response", { layer: "youtube-player-response", retained,
      frameElapsedMs: typeof message.elapsedMs === "number" ? message.elapsedMs : undefined });
    brokerFrameConsumedVideoIds.add(session.videoId);
    session.resolve(message.response);
    if (retained) retainReadyResponse(session, message.response);
    else phase(session, "idle");
    finish(session);
    return;
  }
  if (message.kind === "error") {
    trace(session, "preview.broker-error", {
      layer: typeof message.stage === "string" ? `broker-frame:${message.stage}` : "broker-frame",
      reason: typeof message.error === "string" ? message.error : "unknown-frame-error",
      frameElapsedMs: typeof message.elapsedMs === "number" ? message.elapsedMs : undefined,
    });
    failOrRetry(session, new Error("YouTube's preview renderer did not become ready."));
  }
};

export function installPlaylistTopBroker() {
  if (installed || typeof window.addEventListener !== "function") return { dispose: disposePlaylistTopBroker };
  installed = true;
  useUrlSearch = false;
  window.addEventListener(previewSearchModeEvent, onSearchMode);
  window.addEventListener("message", onBrokerMessage);
  window.addEventListener("pagehide", disposePlaylistTopBroker, { once: true });
  return { dispose: disposePlaylistTopBroker };
}

export function disposePlaylistTopBroker() {
  if (!installed) return;
  installed = false;
  window.removeEventListener?.("message", onBrokerMessage);
  window.removeEventListener?.(previewSearchModeEvent, onSearchMode);
  if (active) cancel(active, "broker-disposed");
  for (const entry of [...readyResponses.values()]) releaseReady(entry, "released");
  readyResponses = new Map();
  releaseFrame("disposed");
}

export function primePlaylistPreviewResponse(video: HTMLElement, videoId: string, rect: PlaylistBrokerRect,
    intent: { actionId: string; trigger: PlaylistPreviewTrigger; startedAtMs?: number; retentionCapacity?: number;
      retryLimit?: number; timeoutMultipliers?: PlaylistBrokerTimeoutMultipliers;
      surface?: "playlist" | "thumbnail"; signal?: AbortSignal } = {
      actionId: `legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`, trigger: "hover",
    }): Promise<unknown> | null {
  if (!installed || window !== window.top || !video.isConnected || !isPlaylistBrokerVideoId(videoId) || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) ||
      !Number.isFinite(rect.width) || !Number.isFinite(rect.height) || rect.width < 24 || rect.height < 24 ||
      typeof intent.actionId !== "string" || !intent.actionId || intent.actionId.length > 100 ||
      !["hover", "focus", "click"].includes(intent.trigger)) return null;
  if (intent.signal?.aborted) return Promise.reject(new Error("Preview preparation was cancelled."));
  // Finish current playback/preparation normally. A new intent adopts the
  // preference using a fresh document rather than reusing the old search mode.
  if (brokerFrame && brokerFrameUsesUrlSearch !== useUrlSearch) {
    if (active) cancel(active, "search-mode-changed");
    releaseFrame("search-mode-changed");
  }
  if (intent.retentionCapacity !== undefined) setPlaylistPreviewRetentionCapacity(intent.retentionCapacity);
  if (active?.actionId === intent.actionId && active.videoId === videoId) {
    active.video = new WeakRef(video);
    active.rect = rect;
    active.retryLimit = normalizePlaylistStageRetryLimit(intent.retryLimit);
    active.timeoutMultipliers = normalizePlaylistBrokerTimeoutMultipliers(intent.timeoutMultipliers);
    if (intent.trigger === "click") active.trigger = "click";
    phase(active, "preparing");
    return active.promise;
  }
  if (active) cancel(active, `new-${intent.trigger}-intent`);
  const refreshReason = brokerFrameConsumedVideoIds.has(videoId) ? "response-consumed" :
    brokerFrameFailedVideoIds.has(videoId) ? "preparation-failed" : "";
  if (brokerFrame?.isConnected && refreshReason) {
    emitPreviewDebugLog("resource.refresh", {
      surface: intent.surface ?? "playlist", resource: "playlist-broker-frame", key: videoId,
      actionId: intent.actionId, trigger: intent.trigger, layer: "broker-top",
      reason: `youtube-same-video-${refreshReason}`,
    });
    releaseFrame(`same-video-${refreshReason}`);
  }
  let resolve!: (response: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  const session: PendingBroker = {
    video: new WeakRef(video), surface: intent.surface, videoId, actionId: intent.actionId, trigger: intent.trigger, requestId: "", rect,
    promise, resolve, reject, timeout: 0, attempt: 1, retryLimit: normalizePlaylistStageRetryLimit(intent.retryLimit),
    timeoutMultipliers: normalizePlaylistBrokerTimeoutMultipliers(intent.timeoutMultipliers),
    stageRetries: { starting: 0, ready: 0, request: 0 }, selected: false, progress: "starting",
    events: new AbortController(),
    startedAt: typeof intent.startedAtMs === "number" && Number.isFinite(intent.startedAtMs) ? intent.startedAtMs : performance.now(),
    attemptStartedAt: performance.now(),
  };
  session.ownerSignal = intent.signal;
  intent.signal?.addEventListener("abort", () => {
    if (session.ownerSignal === intent.signal) cancel(session, "owner-cancelled");
  },
    { once: true, signal: session.events.signal });
  video.addEventListener("ended", () => {
    if (session.video.deref() === video) cancel(session, "preview-ended");
  },
    { once: true, signal: session.events.signal });
  phase(session, "preparing");
  start(session);
  return promise;
}

export function playlistPreviewResponse(videoId: string, actionId?: string,
    owner?: { target: HTMLElement; signal: AbortSignal }): Promise<unknown> | null {
  const session = active;
  if (session && session.videoId === videoId && (actionId === undefined || session.actionId === actionId)) {
    if (owner) {
      session.video = new WeakRef(owner.target);
      session.ownerSignal = owner.signal;
      if (owner.signal.aborted) { cancel(session, "owner-cancelled"); return session.promise; }
      owner.signal.addEventListener("abort", () => {
        if (session.ownerSignal === owner.signal) cancel(session, "owner-cancelled");
      },
        { once: true, signal: session.events.signal });
    }
    prioritize(session);
    return session.promise;
  }
  const ready = readyResponses.get(videoId);
  if (!ready || actionId !== undefined && ready.actionId !== actionId) return null;
  releaseReady(ready, "selected");
  return Promise.resolve(ready.response);
}

export function cancelPlaylistPreviewResponse(videoId: string, actionId: string, reason = "intent-ended") {
  const session = active;
  if (session && session.videoId === videoId && session.actionId === actionId) return cancel(session, reason);
  const ready = readyResponses.get(videoId);
  return Boolean(ready && ready.actionId === actionId && releaseReady(ready, "cancelled"));
}

export function readyPlaylistPreviewResponse(videoId: string): unknown | null {
  return readyResponses.get(videoId)?.response ?? null;
}

export function releasePlaylistPreviewResponse(videoId: string) {
  const ready = readyResponses.get(videoId);
  if (ready) releaseReady(ready, "released");
}
