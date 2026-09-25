import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function importBrowserModule(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${Date.now()}`);
}

test("playlist broker quotes only video IDs that YouTube would parse as search operators", async () => {
  const schema = await importBrowserModule("src/preview-playlist-broker-schema.ts");
  assert.equal(schema.playlistBrokerSearchQuery("XDb_K4KF2qw"), "XDb_K4KF2qw");
  assert.equal(schema.playlistBrokerSearchQuery("-J2rSm8K9_Y"), '"-J2rSm8K9_Y"');
  assert.equal(schema.playlistBrokerSearchQuery("XDb_K4KF2qw", "XDb_K4KF2qw"), '"XDb_K4KF2qw"');
  assert.equal(schema.playlistBrokerSearchQuery("-J2rSm8K9_Y", '"-J2rSm8K9_Y"'), '"-J2rSm8K9_Y" youtube');
});

test("opt-in URL search preserves the complete ID and refreshes consumed renderers", async () => {
  const schema = await importBrowserModule("src/preview-playlist-broker-schema.ts");
  for (const id of ["zvx0SyYEsUA", "-Pk8d6gQccc"]) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    assert.equal(schema.playlistBrokerSearchQuery(id, "", true), url);
    assert.equal(schema.playlistBrokerSearchQuery(id, url, true), `"${url}"`);
    assert.equal(schema.playlistBrokerSearchQuery(id, `"${url}"`, true), url);
  }
});

test("playlist broker roles are explicit imports and top role cannot install fetch interception", async () => {
  const originalWindow = globalThis.window;
  const originalLocation = globalThis.location;
  const fetch = () => {};
  const listeners = [];
  try {
    globalThis.window = { fetch, top: null, addEventListener: (...args) => listeners.push(args), setInterval: () => 1 };
    globalThis.window.top = globalThis.window;
    globalThis.location = { search: "", pathname: "/" };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    const frame = await importBrowserModule("src/preview-playlist-broker-frame.main.ts");
    assert.equal(globalThis.window.fetch, fetch, "importing either explicit role must be side-effect free");
    assert.equal(listeners.length, 0, "the MAIN composition entry, not an import, chooses the role");
    assert.equal(typeof top.installPlaylistTopBroker, "function");
    assert.equal(typeof frame.installPlaylistFrameBroker, "function");

    frame.installPlaylistFrameBroker();
    assert.equal(globalThis.window.fetch, fetch, "a non-broker iframe route must fail closed before intercepting fetch");
    const installed = top.installPlaylistTopBroker();
    assert.deepEqual(listeners.map(([name]) => name), ["skip-ads-preview-search-mode", "message", "pagehide"]);
    assert.equal(globalThis.window.fetch, fetch, "installing the top role cannot intercept fetch");
    installed.dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test("playlist broker keeps one renderer and retains exactly one completed response", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalNow = Date.now;
  const listeners = new Map();
  const sweeps = [];
  const frames = [];
  const posted = [];
  let now = 0;
  let peakConnectedFrames = 0;
  const timingLogs = [];
  let watchdogArms = 0;
  try {
    globalThis.setInterval = callback => { sweeps.push(callback); return sweeps.length; };
    globalThis.clearInterval = () => {};
    Date.now = () => now;
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout: () => ++watchdogArms,
      clearTimeout: () => {},
    };
    globalThis.window.top = globalThis.window;
    globalThis.location = { origin: "https://www.youtube.com", pathname: "/results", search: "" };
    globalThis.document = {
      dispatchEvent(event) { timingLogs.push(JSON.parse(event.detail)); },
      createElement() {
        const frame = {
          dataset: {}, style: {}, isConnected: false,
          contentWindow: { postMessage(value) { posted.push(value); } },
          setAttribute() {}, remove() { this.isConnected = false; },
        };
        frames.push(frame);
        return frame;
      },
      documentElement: {
        getAttribute: () => "true",
        dataset: {},
        append(frame) {
          frame.isConnected = true;
          peakConnectedFrames = Math.max(peakConnectedFrames, frames.filter(candidate => candidate.isConnected).length);
        },
      },
    };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    const installed = top.installPlaylistTopBroker();
    const message = listeners.get("message");
    assert.equal(typeof message, "function");

    const videos = [];
    const phases = [];
    for (let index = 0; index < 6; index++) {
      const videoId = `vid${String(index).padStart(8, "0")}`;
      const video = Object.assign(new EventTarget(), {
        isConnected: true,
        classList: { contains: name => name === "playmium-preview-video" },
      });
      const observed = [];
      video.addEventListener("skip-ads-preview-playlist-warm-phase", event => observed.push(JSON.parse(event.detail).phase));
      videos.push(video);
      phases.push(observed);
      const pending = top.primePlaylistPreviewResponse(video, videoId, { left: 10, top: 10, width: 100, height: 60 });
      assert.ok(pending);
      if (index === 0) {
        assert.ok(Number(frames[0].style.zIndex) < 2147483645,
          "the preparing broker frame must stay below the backdrop/player/playlist interaction layers so wheel scrolling cannot latch to the page");
        assert.equal(frames[0].style.pointerEvents, "none");
      }
      const frame = frames[0];
      if (index === 0) message({ origin: location.origin, source: frame.contentWindow, data: {
        channel: "skip-ads-preview-playlist-broker", kind: "online",
      } });
      const request = index === 0 ? (() => {
        const url = new URL(frame.src, location.origin);
        return {
          channel: "skip-ads-preview-playlist-broker",
          kind: "prepare",
          requestId: url.searchParams.get("skip_inline_preview_broker"),
          videoId,
        };
      })() : posted.at(-1);
      assert.equal(request?.videoId, videoId, "the resident broker did not advance to the requested video");
      if (index === 0) {
        const armsBefore = watchdogArms;
        message({ origin: location.origin, source: frame.contentWindow, data: { ...request, kind: "request-observed", requestId: "stale" } });
        assert.equal(timingLogs.filter(entry => entry.detail.phase === "player-request").length, 0);
        message({ origin: location.origin, source: frame.contentWindow, data: { ...request, kind: "request-observed", elapsedMs: 12.3 } });
        assert.equal(watchdogArms, armsBefore, "v86 timing must not extend playback's watchdog");
        message({ origin: location.origin, source: frame.contentWindow, data: { ...request, kind: "request", elapsedMs: 20 } });
        const requests = timingLogs.filter(entry => entry.event === "preview.broker-progress" && entry.detail.phase === "player-request");
        assert.equal(requests.length, 1, "confirmed progress cannot duplicate the v86 timing marker");
        assert.equal(requests[0].detail.layer, "youtube-player-request");
        assert.equal(requests[0].detail.frameElapsedMs, 12.3);
        assert.equal(watchdogArms, armsBefore + 1, "confirmed progress still advances playback's watchdog");
      }
      message({ origin: location.origin, source: frame.contentWindow, data: { ...request, kind: "response", response: { videoId } } });
      await pending;
      assert.deepEqual(top.readyPlaylistPreviewResponse(videoId), { videoId },
        "the newest completed hover response must remain ready for a warm click");
      if (index > 0) assert.equal(top.readyPlaylistPreviewResponse(`vid${String(index - 1).padStart(8, "0")}`), null,
        "capacity one must evict the previously ready response");
    }

    assert.equal(frames.filter(frame => frame.isConnected).length, 1, "prepared responses must share one resident renderer");
    assert.equal(peakConnectedFrames, 1, "the broker multiplied preview surfaces while preparing new items");
    for (let index = 0; index < 5; index++) assert.equal(top.readyPlaylistPreviewResponse(`vid${String(index).padStart(8, "0")}`), null);
    assert.deepEqual(phases.slice(0, 5), Array.from({ length: 5 }, () => ["preparing", "ready", "idle"]));
    assert.deepEqual(phases[5], ["preparing", "ready"]);
    assert.deepEqual(await top.playlistPreviewResponse("vid00000005"), { videoId: "vid00000005" },
      "a warm click must consume the retained response");
    assert.equal(top.readyPlaylistPreviewResponse("vid00000005"), null);
    assert.deepEqual(phases[5], ["preparing", "ready", "idle"]);
    phases[5].length = 0;
    const postedBeforeRepeat = posted.length;
    const repeated = top.primePlaylistPreviewResponse(videos[5], "vid00000005", { left: 10, top: 10, width: 100, height: 60 });
    assert.ok(repeated, "a consumed warm response must permit a fresh hover preparation");
    assert.equal(frames.length, 2,
      "a video already consumed in this broker document needs one fresh renderer document because YouTube will not issue the response again");
    assert.equal(frames[0].isConnected, false);
    assert.equal(frames[1].isConnected, true);
    assert.equal(peakConnectedFrames, 1, "refreshing a consumed video must replace rather than multiply renderer documents");
    assert.equal(posted.length, postedBeforeRepeat, "the fresh frame owns its initial request through its URL");
    const repeatedFrame = frames[1];
    const repeatedUrl = new URL(repeatedFrame.src, location.origin);
    const repeatedRequest = {
      channel: "skip-ads-preview-playlist-broker",
      requestId: repeatedUrl.searchParams.get("skip_inline_preview_broker"),
      videoId: repeatedUrl.searchParams.get("skip_inline_preview_video"),
    };
    message({ origin: location.origin, source: repeatedFrame.contentWindow, data: {
      channel: repeatedRequest.channel, kind: "online",
    } });
    message({ origin: location.origin, source: repeatedFrame.contentWindow, data: {
      ...repeatedRequest, kind: "response", response: { videoId: "vid00000005" },
    } });
    await repeated;
    assert.deepEqual(top.readyPlaylistPreviewResponse("vid00000005"), { videoId: "vid00000005" });
    installed.dispose();
  } finally {
    Date.now = originalNow;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test("playlist broker retry refreshes a renderer that failed the same video", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const frames = [];
  const listeners = new Map();
  try {
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout: () => 1,
      clearTimeout() {},
    };
    globalThis.window.top = globalThis.window;
    globalThis.location = { origin: "https://www.youtube.com", pathname: "/results", search: "" };
    globalThis.document = {
      createElement() {
        const frame = {
          dataset: {}, style: {}, isConnected: false,
          contentWindow: { postMessage() {} },
          setAttribute() {}, remove() { this.isConnected = false; },
        };
        frames.push(frame);
        return frame;
      },
      documentElement: { dataset: {}, append(frame) { frame.isConnected = true; } },
    };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    const installed = top.installPlaylistTopBroker();
    const message = listeners.get("message");
    const videoId = "failed00001";
    const video = Object.assign(new EventTarget(), {
      isConnected: true,
      classList: { contains: name => name === "playmium-preview-video" },
    });
    const phases = [];
    video.addEventListener("skip-ads-preview-playlist-warm-phase", event => phases.push(JSON.parse(event.detail).phase));

    const first = top.primePlaylistPreviewResponse(video, videoId, { left: 10, top: 10, width: 100, height: 60 },
      { actionId: "single-retry", trigger: "hover", retryLimit: 1 });
    assert.ok(first);
    let settled = false;
    const observed = first.then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
    const failedFrame = frames[0];
    const failedUrl = new URL(failedFrame.src, location.origin);
    message({ origin: location.origin, source: failedFrame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "online",
    } });
    message({ origin: location.origin, source: failedFrame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "error",
      requestId: failedUrl.searchParams.get("skip_inline_preview_broker"), videoId,
      stage: "player-response", error: "Native preview unavailable.",
    } });
    await Promise.resolve();
    assert.equal(settled, false, "a background hover failure must get one automatic recovery attempt");
    assert.equal(frames.length, 2, "player-response recovery must restart with one clean broker document");
    assert.equal(failedFrame.isConnected, false);

    const recoveryFrame = frames[1];
    const recoveryUrl = new URL(recoveryFrame.src, location.origin);
    message({ origin: location.origin, source: recoveryFrame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "error",
      requestId: recoveryUrl.searchParams.get("skip_inline_preview_broker"), videoId,
      stage: "player-response", error: "Native preview unavailable.",
    } });
    assert.ok((await observed).error, "the same failed stage must stop after its single automatic retry");
    assert.deepEqual(phases, ["preparing", "error"]);

    const retry = top.primePlaylistPreviewResponse(video, videoId, { left: 10, top: 10, width: 100, height: 60 },
      { actionId: "manual-retry", trigger: "hover", retryLimit: 1 });
    void retry?.catch(() => {});
    assert.equal(frames.length, 3,
      "Try again must replace the failed same-video renderer instead of reusing its poisoned state");
    assert.equal(recoveryFrame.isConnected, false);
    assert.equal(frames[2].isConnected, true);
    installed.dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test("playlist frame broker ignores a matching renderer from the previous search", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalParent = globalThis.parent;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalHtmlInputElement = globalThis.HTMLInputElement;
  const originalInputEvent = globalThis.InputEvent;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalMouseEvent = globalThis.MouseEvent;
  const initialVideoId = "vid00000001";
  const nextVideoId = "vid00000002";
  const documentListeners = new Map();
  const windowListeners = new Map();
  const messages = [];
  const timers = [];
  let renderers = [];
  let submitted = false;
  try {
    const addListener = (listeners, name, listener) => {
      const values = listeners.get(name) ?? [];
      values.push(listener);
      listeners.set(name, values);
    };
    const renderer = videoId => {
      const thumbnail = {
        isConnected: true,
        parentElement: null,
        dispatchEvent() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 60 }; },
      };
      const value = {
        dataset: {},
        parentElement: null,
        querySelectorAll(selector) { return selector === "a[href*='/watch?']" ? [{ href: `https://www.youtube.com/watch?v=${videoId}` }] : []; },
        querySelector(selector) { return selector === "ytd-thumbnail,yt-thumbnail-view-model" ? thumbnail : null; },
        dispatchEvent() {},
      };
      thumbnail.parentElement = value;
      return value;
    };
    class FakeInput {
      set value(value) { this.currentValue = value; }
      get value() { return this.currentValue ?? ""; }
      closest(selector) { return selector === "form" ? form : null; }
      dispatchEvent() {}
    }
    const input = new FakeInput();
    const form = {
      requestSubmit() {
        submitted = true;
        globalThis.location.search = `?search_query=${nextVideoId}`;
        for (const value of renderers) value.querySelector("ytd-thumbnail,yt-thumbnail-view-model").isConnected = false;
        renderers = [];
      },
    };
    globalThis.location = {
      origin: "https://www.youtube.com",
      pathname: "/results",
      search: `?search_query=${initialVideoId}&skip_inline_preview_broker=initial&skip_inline_preview_video=${initialVideoId}`,
    };
    globalThis.parent = { postMessage(message) { messages.push(message); } };
    globalThis.window = {
      fetch: async () => ({ clone: () => ({ json: async () => ({}) }) }),
      addEventListener(name, listener) { addListener(windowListeners, name, listener); },
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {},
    };
    globalThis.document = {
      readyState: "complete",
      documentElement: {},
      head: { append() {} },
      createElement() { return { textContent: "" }; },
      addEventListener(name, listener) { addListener(documentListeners, name, listener); },
      querySelector(selector) { return selector === 'input[name="search_query"]' ? input : null; },
      querySelectorAll(selector) {
        if (selector === "ytd-video-renderer,yt-lockup-view-model" || selector === "[data-inline-preview-broker]") return renderers;
        return [];
      },
    };
    globalThis.MutationObserver = class {
      constructor(callback) { this.callback = callback; }
      observe() {}
      disconnect() {}
    };
    globalThis.HTMLInputElement = FakeInput;
    globalThis.InputEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
    globalThis.PointerEvent = class {};
    globalThis.MouseEvent = class {};

    renderers = [renderer(initialVideoId), renderer(nextVideoId)];
    const frame = await importBrowserModule("src/preview-playlist-broker-frame.main.ts");
    assert.equal(frame.installPlaylistFrameBroker(), true);
    timers.find(timer => timer.delay === 0)?.callback();
    await globalThis.window.fetch("https://www.youtube.com/youtubei/v1/player", { method: "POST", body: JSON.stringify({ videoId: initialVideoId }) });
    assert.equal(messages.some(message => message.kind === "request" && message.videoId === initialVideoId), true,
      "the frame must report when YouTube's player request has actually been sent");
    messages.length = 0;

    const request = { channel: "skip-ads-preview-playlist-broker", kind: "prepare", requestId: "next", videoId: nextVideoId };
    for (const listener of windowListeners.get("message") ?? []) listener({ origin: location.origin, source: parent, data: request });
    assert.equal(submitted, true);
    assert.equal(input.currentValue, nextVideoId,
      "ordinary video IDs must keep YouTube's direct search path without extra query syntax");
    assert.equal(timers.some(timer => timer.delay === 4_000), true,
      "renderer discovery must get a bounded but non-aggressive timeout before retry");
    assert.equal(messages.some(message => message.kind === "ready" && message.requestId === "next"), false,
      "the broker declared the stale related renderer ready before the new search completed");

    renderers = [renderer(nextVideoId)];
    for (const listener of documentListeners.get("yt-navigate-finish") ?? []) listener();
    assert.equal(messages.some(message => message.kind === "ready" && message.requestId === "next"), true,
      "the broker did not prepare the requested renderer after navigation completed");
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    if (originalParent === undefined) delete globalThis.parent; else globalThis.parent = originalParent;
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = originalMutationObserver;
    if (originalHtmlInputElement === undefined) delete globalThis.HTMLInputElement; else globalThis.HTMLInputElement = originalHtmlInputElement;
    if (originalInputEvent === undefined) delete globalThis.InputEvent; else globalThis.InputEvent = originalInputEvent;
    if (originalPointerEvent === undefined) delete globalThis.PointerEvent; else globalThis.PointerEvent = originalPointerEvent;
    if (originalMouseEvent === undefined) delete globalThis.MouseEvent; else globalThis.MouseEvent = originalMouseEvent;
  }
});

test("playlist frame broker captures a player response delivered through XMLHttpRequest", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalParent = globalThis.parent;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalXMLHttpRequest = globalThis.XMLHttpRequest;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalMouseEvent = globalThis.MouseEvent;
  const videoId = "vid00000008";
  const messages = [];
  const timers = [];
  try {
    const thumbnail = {
      isConnected: true,
      parentElement: null,
      dispatchEvent() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 60 }; },
    };
    const renderer = {
      dataset: {},
      parentElement: null,
      querySelectorAll(selector) { return selector === "a[href*='/watch?']" ? [{ href: `https://www.youtube.com/watch?v=${videoId}` }] : []; },
      querySelector(selector) { return selector === "ytd-thumbnail,yt-thumbnail-view-model" ? thumbnail : null; },
      dispatchEvent() {},
    };
    thumbnail.parentElement = renderer;
    class FakeXMLHttpRequest {
      listeners = new Map();
      responseType = "";
      response = null;
      responseText = "";
      open() {}
      send() {}
      addEventListener(name, listener) { this.listeners.set(name, listener); }
      complete(data, responseType = "json") {
        this.responseType = responseType;
        if (responseType === "json") this.response = data;
        else this.responseText = data;
        this.listeners.get("load")?.();
      }
    }
    globalThis.location = {
      origin: "https://www.youtube.com",
      pathname: "/results",
      search: `?search_query=${videoId}&skip_inline_preview_broker=initial&skip_inline_preview_video=${videoId}`,
    };
    globalThis.parent = { postMessage(message) { messages.push(message); } };
    globalThis.window = {
      fetch: async () => ({ clone: () => ({ json: async () => ({}) }) }),
      addEventListener() {},
      setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {},
    };
    globalThis.document = {
      readyState: "complete",
      documentElement: {},
      head: { append() {} },
      createElement() { return { textContent: "" }; },
      addEventListener() {},
      querySelector() { return null; },
      querySelectorAll(selector) {
        if (selector === "ytd-video-renderer,yt-lockup-view-model" || selector === "[data-inline-preview-broker]") return [renderer];
        return [];
      },
    };
    globalThis.MutationObserver = class { observe() {} disconnect() {} };
    globalThis.XMLHttpRequest = FakeXMLHttpRequest;
    globalThis.PointerEvent = class {};
    globalThis.MouseEvent = class {};

    const frame = await importBrowserModule("src/preview-playlist-broker-frame.main.ts");
    assert.equal(frame.installPlaylistFrameBroker(), true);
    timers.find(timer => timer.delay === 0)?.callback();
    const malformedXhr = new XMLHttpRequest();
    malformedXhr.open("POST", "https://www.youtube.com/youtubei/v1/player");
    malformedXhr.send(JSON.stringify({ videoId }));
    malformedXhr.complete("{", "text");
    assert.equal(messages.some(message => message.kind === "invalid" && message.reason === "response-parse"), true,
      "a malformed player response must be logged before the response watchdog continues");

    const invalidXhr = new XMLHttpRequest();
    invalidXhr.open("POST", "https://www.youtube.com/youtubei/v1/player");
    invalidXhr.send(JSON.stringify({ videoId }));
    invalidXhr.complete({ videoDetails: { videoId }, playabilityStatus: { status: "ERROR" } });
    assert.equal(messages.some(message => message.kind === "invalid" && message.reason === "playability-status" &&
      message.playabilityStatus === "ERROR" && message.hasStreamingData === false), true,
    "a rejected YouTube player response must expose its bounded reason instead of disappearing into a later timeout");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://www.youtube.com/youtubei/v1/player");
    xhr.send(JSON.stringify({ videoId }));
    xhr.complete({ videoDetails: { videoId }, playabilityStatus: { status: "OK" }, streamingData: {} });

    assert.equal(messages.some(message => message.kind === "request" && message.videoId === videoId), true,
      "an XHR player request must count as broker progress");
    assert.equal(messages.some(message => message.kind === "response" && message.videoId === videoId), true,
      "an XHR player response must resolve the broker instead of timing out");
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    if (originalParent === undefined) delete globalThis.parent; else globalThis.parent = originalParent;
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = originalMutationObserver;
    if (originalXMLHttpRequest === undefined) delete globalThis.XMLHttpRequest; else globalThis.XMLHttpRequest = originalXMLHttpRequest;
    if (originalPointerEvent === undefined) delete globalThis.PointerEvent; else globalThis.PointerEvent = originalPointerEvent;
    if (originalMouseEvent === undefined) delete globalThis.MouseEvent; else globalThis.MouseEvent = originalMouseEvent;
  }
});

test("playlist frame broker resets native hover before preparing the same video again", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalParent = globalThis.parent;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalHtmlInputElement = globalThis.HTMLInputElement;
  const originalInputEvent = globalThis.InputEvent;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalMouseEvent = globalThis.MouseEvent;
  const videoId = "vid00000009";
  const messages = [];
  const timers = [];
  const documentListeners = new Map();
  let hovered = false;
  let playerRequests = 0;
  let stoppedPlayers = 0;
  let rendererVisible = true;
  let submitted = false;
  try {
    class FakeEvent {
      constructor(type) { this.type = type; }
    }
    const thumbnail = {
      isConnected: true,
      parentElement: null,
      dispatchEvent(event) {
        if (event.type === "mouseenter" && !hovered) {
          hovered = true;
          playerRequests++;
          void globalThis.window.fetch("https://www.youtube.com/youtubei/v1/player", { method: "POST", body: JSON.stringify({ videoId }) });
        }
        if (event.type === "mouseleave") hovered = false;
      },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 60 }; },
    };
    const renderer = {
      dataset: {},
      parentElement: null,
      querySelectorAll(selector) { return selector === "a[href*='/watch?']" ? [{ href: `https://www.youtube.com/watch?v=${videoId}` }] : []; },
      querySelector(selector) { return selector === "ytd-thumbnail,yt-thumbnail-view-model" ? thumbnail : null; },
      dispatchEvent() {},
    };
    thumbnail.parentElement = renderer;
    class FakeInput {
      set value(value) { this.currentValue = value; }
      get value() { return this.currentValue ?? ""; }
      closest(selector) { return selector === "form" ? form : null; }
      dispatchEvent() {}
    }
    const input = new FakeInput();
    const form = {
      requestSubmit() {
        submitted = true;
        rendererVisible = false;
        thumbnail.isConnected = false;
        globalThis.location.search = `?search_query=${encodeURIComponent(`"${videoId}"`)}`;
      },
    };
    globalThis.location = {
      origin: "https://www.youtube.com",
      pathname: "/results",
      search: `?search_query=${videoId}&skip_inline_preview_broker=initial&skip_inline_preview_video=${videoId}`,
    };
    globalThis.parent = { postMessage(message) { messages.push(message); } };
    globalThis.window = {
      fetch: async () => ({ clone: () => ({ json: async () => ({
        videoDetails: { videoId }, playabilityStatus: { status: "OK" }, streamingData: {},
      }) }) }),
      addEventListener(name, listener) { if (name === "message") this.messageListener = listener; },
      setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timers.length; },
      clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
    };
    globalThis.document = {
      readyState: "complete",
      documentElement: {},
      head: { append() {} },
      createElement() { return { textContent: "" }; },
      addEventListener(name, listener) {
        const values = documentListeners.get(name) ?? [];
        values.push(listener);
        documentListeners.set(name, values);
      },
      querySelector(selector) { return selector === 'input[name="search_query"]' ? input : null; },
      querySelectorAll(selector) {
        if (selector === "ytd-video-preview") return [{ stopPlayer() { stoppedPlayers++; } }];
        if (selector === "ytd-video-renderer,yt-lockup-view-model" || selector === "[data-inline-preview-broker]") {
          return rendererVisible ? [renderer] : [];
        }
        return [];
      },
    };
    globalThis.MutationObserver = class { observe() {} disconnect() {} };
    globalThis.HTMLInputElement = FakeInput;
    globalThis.InputEvent = class { constructor(type, options) { this.type = type; Object.assign(this, options); } };
    globalThis.PointerEvent = FakeEvent;
    globalThis.MouseEvent = FakeEvent;

    const frame = await importBrowserModule("src/preview-playlist-broker-frame.main.ts");
    assert.equal(frame.installPlaylistFrameBroker(), true);
    timers.find(timer => timer.delay === 0 && !timer.cleared)?.callback();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(playerRequests, 1);
    assert.equal(messages.filter(message => message.kind === "response").length, 1);

    globalThis.window.messageListener({ origin: location.origin, source: parent, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "prepare", requestId: "repeat", videoId,
    } });
    assert.equal(submitted, true,
      "a consumed same-video response must refresh the search renderer instead of reusing YouTube's exhausted hover state");
    assert.equal(input.currentValue, `"${videoId}"`, "same-video refresh must preserve literal ID search semantics");
    assert.equal(messages.filter(message => message.kind === "ready").length, 1,
      "the previous renderer must not be declared ready for the repeated action");
    rendererVisible = true;
    thumbnail.isConnected = true;
    for (const listener of documentListeners.get("yt-navigate-finish") ?? []) listener();
    timers.filter(timer => timer.delay === 0 && !timer.cleared).at(-1)?.callback();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    assert.equal(playerRequests, 2,
      "a consumed response must leave native hover so selecting that playlist video again starts a fresh player request");
    assert.ok(stoppedPlayers >= 2, "each completed native preview must be stopped before the renderer is reused");
    assert.equal(messages.filter(message => message.kind === "response").length, 2);
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    if (originalParent === undefined) delete globalThis.parent; else globalThis.parent = originalParent;
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = originalMutationObserver;
    if (originalHtmlInputElement === undefined) delete globalThis.HTMLInputElement; else globalThis.HTMLInputElement = originalHtmlInputElement;
    if (originalInputEvent === undefined) delete globalThis.InputEvent; else globalThis.InputEvent = originalInputEvent;
    if (originalPointerEvent === undefined) delete globalThis.PointerEvent; else globalThis.PointerEvent = originalPointerEvent;
    if (originalMouseEvent === undefined) delete globalThis.MouseEvent; else globalThis.MouseEvent = originalMouseEvent;
  }
});

test("playlist frame broker physically stops a cancelled preparation", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalParent = globalThis.parent;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalPointerEvent = globalThis.PointerEvent;
  const originalMouseEvent = globalThis.MouseEvent;
  const originalClearTimeout = globalThis.clearTimeout;
  const videoId = "vid00000010";
  const requestId = "cancel-me";
  const timers = [];
  const messages = [];
  const dispatched = [];
  let stoppedPlayers = 0;
  let pausedMedia = 0;
  try {
    class FakeEvent { constructor(type) { this.type = type; } }
    const thumbnail = {
      isConnected: true,
      parentElement: null,
      dispatchEvent(event) { dispatched.push(event.type); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 60 }; },
    };
    const renderer = {
      dataset: {}, parentElement: null,
      querySelectorAll(selector) { return selector === "a[href*='/watch?']" ? [{ href: `https://www.youtube.com/watch?v=${videoId}` }] : []; },
      querySelector(selector) { return selector === "ytd-thumbnail,yt-thumbnail-view-model" ? thumbnail : null; },
      dispatchEvent(event) { dispatched.push(event.type); },
    };
    thumbnail.parentElement = renderer;
    globalThis.location = {
      origin: "https://www.youtube.com", pathname: "/results",
      search: `?search_query=${videoId}&skip_inline_preview_broker=${requestId}&skip_inline_preview_video=${videoId}`,
    };
    globalThis.parent = { postMessage(message) { messages.push(message); } };
    globalThis.window = {
      fetch: async () => ({ clone: () => ({ json: async () => ({}) }) }),
      addEventListener(name, listener) { if (name === "message") this.messageListener = listener; },
      setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timers.length; },
      clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
    };
    globalThis.clearTimeout = id => globalThis.window.clearTimeout(id);
    globalThis.document = {
      readyState: "complete", documentElement: {}, head: { append() {} },
      createElement() { return { textContent: "" }; }, addEventListener() {}, querySelector() { return null; },
      querySelectorAll(selector) {
        if (selector === "ytd-video-renderer,yt-lockup-view-model" || selector === "[data-inline-preview-broker]") return [renderer];
        if (selector === "ytd-video-preview") return [{ stopPlayer() { stoppedPlayers++; } }];
        if (selector === "video,audio") return [{ muted: false, volume: 1, pause() { pausedMedia++; } }];
        return [];
      },
    };
    globalThis.MutationObserver = class { observe() {} disconnect() {} };
    globalThis.PointerEvent = FakeEvent;
    globalThis.MouseEvent = FakeEvent;

    const frame = await importBrowserModule("src/preview-playlist-broker-frame.main.ts");
    assert.equal(frame.installPlaylistFrameBroker(), true);
    timers.find(timer => timer.delay === 0 && !timer.cleared)?.callback();
    globalThis.window.messageListener({ origin: location.origin, source: parent, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "rewake", requestId, videoId,
    } });
    timers.filter(timer => timer.delay === 0 && !timer.cleared).at(-1)?.callback();
    assert.equal(messages.filter(message => message.kind === "ready").length, 2,
      "ready-stage recovery must prepare the existing renderer again without SPA navigation");
    globalThis.window.messageListener({ origin: location.origin, source: parent, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "cancel", requestId, videoId,
    } });

    assert.ok(timers.filter(timer => [0, 100, 300, 700, 1200].includes(timer.delay)).every(timer => timer.cleared),
      "cancel must clear every pending native-hover wake");
    assert.ok(dispatched.includes("pointerleave") && dispatched.includes("mouseleave"),
      "cancel must leave the synthetic hover surface");
    assert.ok(stoppedPlayers >= 1, "cancel must stop YouTube's native preview player");
    assert.ok(pausedMedia >= 1, "cancel must pause broker media");
    assert.equal(messages.some(message => message.kind === "response"), false,
      "cancelled preparation must not publish a response");
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
    if (originalParent === undefined) delete globalThis.parent; else globalThis.parent = originalParent;
    if (originalMutationObserver === undefined) delete globalThis.MutationObserver; else globalThis.MutationObserver = originalMutationObserver;
    if (originalPointerEvent === undefined) delete globalThis.PointerEvent; else globalThis.PointerEvent = originalPointerEvent;
    if (originalMouseEvent === undefined) delete globalThis.MouseEvent; else globalThis.MouseEvent = originalMouseEvent;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
