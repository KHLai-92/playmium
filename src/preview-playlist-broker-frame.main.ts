import {
  isPlaylistBrokerCancel,
  isPlaylistBrokerRewake,
  isPlaylistBrokerRequest,
  isPlaylistBrokerVideoId,
  playlistBrokerChannel,
  playlistBrokerRequestParameter,
  playlistBrokerSearchQuery,
  playlistBrokerSearchModeParameter,
  playlistBrokerVideoParameter,
  type PlaylistBrokerMessage,
} from "./preview-playlist-broker-schema";

function nativePlayerVideoId(body: unknown) {
  if (body instanceof URLSearchParams) return body.get("videoId") ?? "";
  if (typeof body !== "string") return "";
  try {
    const value = JSON.parse(body)?.videoId;
    return isPlaylistBrokerVideoId(value) ? value : "";
  } catch { return ""; }
}

export function installPlaylistFrameBroker() {
  const params = new URLSearchParams(location.search);
  const initialRequestId = params.get(playlistBrokerRequestParameter);
  const initialVideoId = params.get(playlistBrokerVideoParameter);
  const useUrlSearch = params.get(playlistBrokerSearchModeParameter) === "url";
  if (!initialRequestId || initialRequestId.length > 100 || !isPlaylistBrokerVideoId(initialVideoId) || location.pathname !== "/results") return false;

  type FrameJob = { requestId: string; videoId: string; prepared: boolean; blurDismissRequested: boolean; startedAt: number; invalidResponses: Set<string>; transport: AbortController; xhrs: Set<XMLHttpRequest> };
  let current: FrameJob | null = null;
  let wakeStarted = false;
  let playerRequestStarted = false;
  let playerRequestObserved = false;
  let wakeTimers: number[] = [];
  let rendererObserver: MutationObserver | null = null;
  let navigationEvents: AbortController | null = null;
  let prepareTimeout = 0;
  let hoveredSurface: { renderer: HTMLElement; thumbnail: HTMLElement } | null = null;
  let nativeBlurControl: HTMLElement | null = null;
  const send = (job: FrameJob, kind: string, response?: unknown, stage?: string, error?: string) =>
    parent.postMessage({ channel: playlistBrokerChannel, kind, requestId: job.requestId, videoId: job.videoId, response,
      stage, error, elapsedMs: Math.round((performance.now() - job.startedAt) * 10) / 10 }, location.origin);
  const stopWakes = () => {
    for (const timer of wakeTimers) clearTimeout(timer);
    wakeTimers = [];
  };
  const silenceMedia = (media: HTMLMediaElement) => {
    media.muted = true;
    media.volume = 0;
    if (!current) media.pause();
  };
  const leaveHoveredSurface = () => {
    const surface = hoveredSurface;
    hoveredSurface = null;
    if (!surface?.thumbnail.isConnected) return;
    const rect = surface.thumbnail.getBoundingClientRect();
    const init = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window };
    const lineage: Element[] = [];
    for (let item: Element | null = surface.thumbnail; item; item = item.parentElement) {
      lineage.push(item);
      if (item === surface.renderer) break;
    }
    for (const item of lineage) {
      item.dispatchEvent(new PointerEvent("pointerleave", { ...init, pointerType: "mouse" }));
      item.dispatchEvent(new MouseEvent("mouseleave", init));
    }
    surface.thumbnail.dispatchEvent(new MouseEvent("mouseout", { ...init, bubbles: true }));
  };
  const resetSurface = () => {
    current?.transport.abort();
    current?.xhrs.forEach(xhr => { try { xhr.abort(); } catch { /* Continue cancelling. */ } });
    current?.xhrs.clear();
    stopWakes();
    rendererObserver?.disconnect();
    rendererObserver = null;
    navigationEvents?.abort();
    navigationEvents = null;
    clearTimeout(prepareTimeout);
    prepareTimeout = 0;
    leaveHoveredSurface();
    document.querySelectorAll<HTMLElement>("ytd-video-preview").forEach(preview => {
      try {
        (preview as HTMLElement & { stopPlayer?: () => void }).stopPlayer?.();
      } catch {}
    });
    document.querySelectorAll<HTMLElement>("[data-inline-preview-broker]").forEach(renderer => {
      delete renderer.dataset.inlinePreviewBroker;
    });
    document.querySelectorAll<HTMLMediaElement>("video,audio").forEach(media => {
      media.muted = true;
      media.volume = 0;
      media.pause();
    });
  };
  const finishJob = (job: FrameJob) => {
    if (current !== job) return;
    resetSurface();
    current = null;
  };
  document.addEventListener("play", event => {
    if (event.target instanceof HTMLMediaElement) silenceMedia(event.target);
  }, true);
  const mediaObserver = new MutationObserver(records => {
    // A renderer mutation is not a reason to scan/mute every media node in the
    // YouTube document. Only inspect newly inserted media subtrees.
    for (const record of records) for (const added of record.addedNodes) {
      if (!(added instanceof Element)) continue;
      if (added instanceof HTMLMediaElement) silenceMedia(added);
      added.querySelectorAll<HTMLMediaElement>("video,audio").forEach(silenceMedia);
    }
  });
  mediaObserver.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => { if (current) finishJob(current); mediaObserver.disconnect(); }, { once: true });

  // Match v86's measurement: observe the first player endpoint request after
  // waking, before inspecting its body. Observation must not own transport or
  // change the confirmed progress used by the playback watchdog.
  const observePlayerRequest = (job: FrameJob) => {
    if (current !== job || !wakeStarted || playerRequestObserved) return;
    playerRequestObserved = true;
    send(job, "request-observed");
  };
  const notePlayerRequest = (job: FrameJob) => {
    if (current !== job || !wakeStarted) return;
    if (!playerRequestStarted) send(job, "request");
    playerRequestStarted = true;
    stopWakes();
  };
  const reportInvalidPlayerResponse = (job: FrameJob, reason: string, observedVideoId = "",
      playabilityStatus = "", hasStreamingData = false) => {
    if (current !== job) return;
    const fingerprint = `${reason}:${observedVideoId}:${playabilityStatus}:${hasStreamingData}`;
    if (job.invalidResponses.has(fingerprint)) return;
    job.invalidResponses.add(fingerprint);
    parent.postMessage({
      channel: playlistBrokerChannel, kind: "invalid", requestId: job.requestId, videoId: job.videoId,
      reason, observedVideoId, playabilityStatus, hasStreamingData,
      elapsedMs: Math.round((performance.now() - job.startedAt) * 10) / 10,
    }, location.origin);
  };
  const acceptPlayerResponse = (job: FrameJob, data: unknown) => {
    const response = data as {
      videoDetails?: { videoId?: unknown };
      playabilityStatus?: { status?: unknown };
      streamingData?: unknown;
    } | null;
    if (current !== job) return;
    const observedVideoId = typeof response?.videoDetails?.videoId === "string" ? response.videoDetails.videoId.slice(0, 32) : "";
    const playabilityStatus = typeof response?.playabilityStatus?.status === "string"
      ? response.playabilityStatus.status.slice(0, 40) : "";
    const hasStreamingData = Boolean(response?.streamingData);
    const reason = observedVideoId !== job.videoId ? "video-id-mismatch" :
      playabilityStatus !== "OK" ? "playability-status" : !hasStreamingData ? "missing-streaming-data" : "";
    if (reason) {
      reportInvalidPlayerResponse(job, reason, observedVideoId, playabilityStatus, hasStreamingData);
      return;
    }
    send(job, "response", response);
    finishJob(job);
  };
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const url = args[0] instanceof Request ? args[0].url : String(args[0] ?? "");
    const candidate = current && wakeStarted && url.includes("/youtubei/v1/player") ? current : null;
    if (candidate) observePlayerRequest(candidate);
    let body = args[1]?.body;
    if (candidate && body === undefined && args[0] instanceof Request) {
      try { body = await args[0].clone().text(); } catch { /* Unknown identity cannot own preparation progress. */ }
    } else if (candidate && body instanceof Blob) body = await body.text();
    const requestedVideoId = nativePlayerVideoId(body);
    const job = candidate && requestedVideoId === candidate.videoId ? candidate : null;
    if (job) notePlayerRequest(job);
    const callerSignal = args[1]?.signal ?? (args[0] instanceof Request ? args[0].signal : null);
    const response = await originalFetch.call(this, args[0], job ? { ...args[1],
      signal: callerSignal ? AbortSignal.any([callerSignal, job.transport.signal]) : job.transport.signal } : args[1]);
    // An opaque/legacy request may still yield the target response, but cannot
    // stop hover wakes or acquire the job's transport lifetime without identity.
    const receiver = job ?? (!requestedVideoId ? candidate : null);
    if (receiver && current === receiver) {
      void response.clone().json().then(data => acceptPlayerResponse(receiver, data), () => {
        reportInvalidPlayerResponse(receiver, "response-parse");
      });
    }
    return response;
  };
  if (typeof XMLHttpRequest !== "undefined") {
    const playerRequests = new WeakSet<XMLHttpRequest>();
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async: boolean = true,
        username?: string | null, password?: string | null) {
      playerRequests.delete(this);
      if (String(url).includes("/youtubei/v1/player")) playerRequests.add(this);
      if (username !== undefined || password !== undefined) {
        return originalOpen.call(this, method, url, async, username ?? null, password ?? null);
      }
      return originalOpen.call(this, method, url, async);
    };
    XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
      if (playerRequests.has(this)) {
        const candidate = wakeStarted ? current : null;
        if (candidate) observePlayerRequest(candidate);
        const requestedVideoId = nativePlayerVideoId(body);
        const job = candidate && requestedVideoId === candidate.videoId ? candidate : null;
        if (job) {
          notePlayerRequest(job);
          job.xhrs.add(this);
          this.addEventListener("loadend", () => job.xhrs.delete(this), { once: true });
        }
        const receiver = job ?? (!requestedVideoId ? candidate : null);
        if (receiver) {
          this.addEventListener("load", () => {
            let data: unknown;
            try {
              data = this.responseType === "json" ? this.response : JSON.parse(this.responseText);
            } catch {
              reportInvalidPlayerResponse(receiver, "response-parse");
              return;
            }
            acceptPlayerResponse(receiver, data);
          }, { once: true, signal: receiver.transport.signal });
        }
      }
      return originalSend.call(this, body ?? null);
    };
  }

  const prepare = (job: FrameJob) => {
    if (current !== job || job.prepared) return false;
    const renderer = [...document.querySelectorAll<HTMLElement>("ytd-video-renderer,yt-lockup-view-model")].find(candidate =>
      [...candidate.querySelectorAll<HTMLAnchorElement>("a[href*='/watch?']")].some(anchor => {
        try { return new URL(anchor.href).searchParams.get("v") === job.videoId; } catch { return false; }
      }));
    const thumbnail = renderer?.querySelector<HTMLElement>("ytd-thumbnail,yt-thumbnail-view-model");
    if (!renderer || !thumbnail) return false;
    const inlineUnplayable = renderer.querySelector("ytd-thumbnail-overlay-inline-unplayable-renderer");
    // A blurred search card can be marked inline-unplayable even though the
    // video supports native preview. Use the verified YouTube control, then
    // wait for its replacement card instead of waking the blocked renderer.
    if (job.blurDismissRequested && inlineUnplayable) return false;
    if (inlineUnplayable && !job.blurDismissRequested) {
      const chip = [...document.querySelectorAll<HTMLElement>("yt-chip-cloud-chip-renderer")]
        .find(item => item.textContent?.trim() === "關閉模糊效果" && !item.hasAttribute("selected"));
      const button = chip?.querySelector<HTMLElement>("button");
      if (button) {
        job.blurDismissRequested = true;
        nativeBlurControl = button;
        try { button.click(); } finally { nativeBlurControl = null; }
        return false;
      }
    }
    job.prepared = true;
    clearTimeout(prepareTimeout);
    prepareTimeout = 0;
    renderer.dataset.inlinePreviewBroker = "";
    send(job, "ready");
    const wake = () => {
      if (current !== job || playerRequestStarted || !thumbnail.isConnected) return;
      wakeStarted = true;
      hoveredSurface = { renderer, thumbnail };
      const rect = thumbnail.getBoundingClientRect();
      const init = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window };
      const lineage: Element[] = [];
      for (let item: Element | null = thumbnail; item; item = item.parentElement) {
        lineage.push(item);
        if (item === renderer) break;
      }
      for (const item of lineage.reverse()) {
        item.dispatchEvent(new PointerEvent("pointerenter", { ...init, pointerType: "mouse" }));
        item.dispatchEvent(new MouseEvent("mouseenter", init));
      }
      thumbnail.dispatchEvent(new MouseEvent("mouseover", { ...init, bubbles: true }));
      thumbnail.dispatchEvent(new MouseEvent("mousemove", { ...init, bubbles: true }));
    };
    wakeTimers = [0, 100, 300, 700, 1200].map(delay => window.setTimeout(wake, delay));
    return true;
  };

  const failAfterPrepareTimeout = (job: FrameJob) => {
    if (prepareTimeout) return;
    prepareTimeout = window.setTimeout(() => {
      if (current !== job) return;
      send(job, "error", undefined, "renderer-discovery", "matching-renderer-timeout");
      finishJob(job);
    }, 4_000);
  };

  const watchForRenderer = (job: FrameJob) => {
    rendererObserver = new MutationObserver(() => {
      if (!prepare(job)) return;
      rendererObserver?.disconnect();
      rendererObserver = null;
      clearTimeout(prepareTimeout);
      prepareTimeout = 0;
    });
    rendererObserver.observe(document.documentElement, { childList: true, subtree: true });
    if (prepare(job)) {
      rendererObserver.disconnect();
      rendererObserver = null;
      return;
    }
    failAfterPrepareTimeout(job);
  };

  const begin = (requestId: string, videoId: string, navigate: boolean) => {
    resetSurface();
    wakeStarted = false;
    playerRequestStarted = false;
    playerRequestObserved = false;
    const job = { requestId, videoId, prepared: false, blurDismissRequested: false, startedAt: performance.now(), invalidResponses: new Set<string>(), transport: new AbortController(), xhrs: new Set<XMLHttpRequest>() };
    current = job;
    if (!navigate) {
      watchForRenderer(job);
      return;
    }
    const input = document.querySelector<HTMLInputElement>('input[name="search_query"]');
    const form = input?.closest("form");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (!input || !form || !setter) {
      send(job, "error", undefined, "spa-navigation", "search-form-unavailable");
      finishJob(job);
      return;
    }
    const events = new AbortController();
    navigationEvents = events;
    document.addEventListener("yt-navigate-finish", () => {
      if (current !== job) return;
      events.abort();
      if (navigationEvents === events) navigationEvents = null;
      watchForRenderer(job);
    }, { once: true, signal: events.signal });
    failAfterPrepareTimeout(job);
    // YouTube keeps the completed native hover state on a search renderer. With
    // zero extension retention, reusing that renderer cannot produce a second
    // player response. Alternate the target query so the resident
    // SPA creates a fresh renderer without allocating another document.
    const currentQuery = new URLSearchParams(location.search).get("search_query") ?? "";
    const searchQuery = playlistBrokerSearchQuery(videoId, currentQuery, useUrlSearch);
    setter.call(input, searchQuery);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: searchQuery }));
    form.requestSubmit();
  };

  document.addEventListener("click", event => {
    const job = current;
    if (!job) return;
    // Permit only the synchronous native control click initiated above. User
    // clicks in the acquisition frame still belong to the extension preview.
    if (nativeBlurControl && event.target === nativeBlurControl) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    send(job, "click");
  }, true);
  window.addEventListener("message", event => {
    const message = event.data as PlaylistBrokerMessage;
    if (event.origin !== location.origin || event.source !== parent) return;
    if (isPlaylistBrokerCancel(message)) {
      const job = current;
      if (job && job.requestId === message.requestId && job.videoId === message.videoId) finishJob(job);
      return;
    }
    if (isPlaylistBrokerRewake(message)) {
      const job = current;
      if (job && job.requestId === message.requestId && job.videoId === message.videoId) {
        begin(message.requestId, message.videoId, false);
      }
      return;
    }
    if (!isPlaylistBrokerRequest(message)) return;
    begin(message.requestId, message.videoId, true);
  });
  const start = () => {
    const style = document.createElement("style");
    style.textContent = `
      html,body{margin:0!important;overflow:hidden!important;background:transparent!important}
      ytd-app>*{visibility:hidden!important}
      [data-inline-preview-broker],
      [data-inline-preview-broker] *{visibility:visible!important}
      [data-inline-preview-broker]{display:block!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;z-index:2147483647!important;margin:0!important;padding:0!important;background:transparent!important}
      [data-inline-preview-broker] #dismissible,
      [data-inline-preview-broker] ytd-thumbnail,
      [data-inline-preview-broker] yt-thumbnail-view-model,
      [data-inline-preview-broker] #thumbnail{display:block!important;position:absolute!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;padding:0!important}
      [data-inline-preview-broker] .text-wrapper{display:none!important}
    `;
    document.head.append(style);
    parent.postMessage({ channel: playlistBrokerChannel, kind: "online" }, location.origin);
    begin(initialRequestId, initialVideoId, false);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
  return true;
}
