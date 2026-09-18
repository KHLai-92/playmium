import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function importBrowserModule(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${Date.now()}`);
}

test("clicked preparation preempts hover work and retries with one connected frame", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const listeners = new Map();
  const frames = [];
  const posted = [];
  const timeoutDelays = [];
  try {
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout(_callback, delay) { timeoutDelays.push(delay); return timeoutDelays.length; },
      clearTimeout: () => {},
    };
    globalThis.window.top = globalThis.window;
    globalThis.location = { origin: "https://www.youtube.com", pathname: "/results", search: "" };
    globalThis.document = {
      createElement() {
        const frame = {
          dataset: {}, style: {}, isConnected: false,
          contentWindow: { postMessage(message) { posted.push(message); } },
          setAttribute() {}, remove() { this.isConnected = false; },
        };
        frames.push(frame);
        return frame;
      },
      documentElement: {
        dataset: {},
        append(frame) { frame.isConnected = true; },
      },
    };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    const installed = top.installPlaylistTopBroker();
    const makeVideo = () => Object.assign(new EventTarget(), {
      isConnected: true,
      classList: { contains: name => name === "skip-ads-preview-prototype-video" },
    });
    const videoA = makeVideo();
    const videoB = makeVideo();
    const phasesA = [];
    const phasesB = [];
    videoA.addEventListener("skip-ads-preview-playlist-warm-phase", event => phasesA.push(JSON.parse(event.detail).phase));
    videoB.addEventListener("skip-ads-preview-playlist-warm-phase", event => phasesB.push(JSON.parse(event.detail).phase));

    const pendingA = top.primePlaylistPreviewResponse(videoA, "vid00000001", { left: 10, top: 10, width: 100, height: 60 });
    const observedA = pendingA.then(value => ({ value }), error => ({ error }));
    const pendingB = top.primePlaylistPreviewResponse(videoB, "vid00000002", { left: 10, top: 80, width: 100, height: 60 });
    const observedB = pendingB.then(value => ({ value }), error => ({ error }));
    await Promise.resolve();

    assert.equal(frames.length, 1,
      "concurrent preparation must not multiply full YouTube renderer frames and delay playlist scrolling");
    assert.deepEqual(phasesA, ["preparing", "idle"], "moving to another row must release the old logical preparation");
    assert.deepEqual(phasesB, ["preparing"]);
    assert.equal(posted.some(message => message.kind === "cancel" && message.videoId === "vid00000001"), true,
      "superseding preparation must tell the broker frame to stop the abandoned job");

    const send = (frame, request, kind, response) => {
      const url = request ?? Object.fromEntries(new URL(frame.src, location.origin).searchParams);
      listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: {
        channel: "skip-ads-preview-playlist-broker", kind,
        requestId: request?.requestId ?? url.skip_inline_preview_broker,
        videoId: request?.videoId ?? url.skip_inline_preview_video,
        ...(response ? { response } : { error: "renderer timeout" }),
      } });
    };

    const selectedB = top.playlistPreviewResponse("vid00000002");
    assert.equal(selectedB, pendingB, "selection must keep the original logical preparation alive");
    const selectedFrame = frames.at(-1);
    assert.equal(selectedFrame, frames[0], "selection must reuse the resident broker document");
    assert.equal(selectedFrame.isConnected, true, "selection must keep the broker document connected");
    assert.equal(frames.filter(frame => frame.isConnected).length, 1,
      "selection preemption must keep exactly one broker iframe connected");
    listeners.get("message")({ origin: location.origin, source: selectedFrame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "online",
    } });
    const selectedUrl = new URL(selectedFrame.src, location.origin);
    assert.equal(selectedUrl.searchParams.get("skip_inline_preview_video"), "vid00000002",
      "a newer intent must replace the request URL of a broker document that is not online yet");
    assert.equal(posted.filter(message => message.kind === "prepare").length, 0,
      "the latest request carried by a restarted document must not be duplicated after its online handshake");
    send(selectedFrame, null, "response", { videoDetails: { videoId: "vid00000002" }, streamingData: {} });
    assert.deepEqual(await observedB, { value: { videoDetails: { videoId: "vid00000002" }, streamingData: {} } });
    assert.equal(posted.filter(message => message.kind === "prepare").length, 0,
      "superseded hover work must never resume after the click finishes");
    assert.match((await observedA).error?.message ?? "", /superseded/i);
    assert.deepEqual(phasesB, ["preparing", "idle"],
      "a completed response that is not retained must not leave a false ready state");
    assert.deepEqual(phasesA, ["preparing", "idle"]);

    const postedBeforeRepeat = posted.length;
    const repeatedBRequest = top.primePlaylistPreviewResponse(videoB, "vid00000002", { left: 10, top: 80, width: 100, height: 60 });
    assert.ok(repeatedBRequest, "a selected response must permit a fresh hover preparation");
    assert.equal(frames.length, 2, "repeating a consumed video needs one fresh YouTube renderer document");
    assert.equal(selectedFrame.isConnected, false);
    const repeatedFrame = frames.at(-1);
    assert.equal(repeatedFrame.isConnected, true);
    assert.equal(posted.length, postedBeforeRepeat, "the replacement frame carries its initial request in the URL");
    listeners.get("message")({ origin: location.origin, source: repeatedFrame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "online",
    } });
    send(repeatedFrame, null, "response", { videoDetails: { videoId: "vid00000002" }, streamingData: {} });
    const repeatedB = await repeatedBRequest;
    assert.equal(repeatedB.videoDetails.videoId, "vid00000002", "fresh hover preparation must return the requested response");
    assert.deepEqual(phasesB.slice(-2), ["preparing", "ready"],
      "repeated hover preparation must expose a retained ready response");
    assert.equal(top.readyPlaylistPreviewResponse("vid00000002")?.videoDetails?.videoId, "vid00000002",
      "a completed hover response must be retained");
    assert.equal(frames.filter(frame => frame.isConnected).length, 1,
      "re-hovering without retention must keep exactly one connected renderer");

    const videoC = makeVideo();
    const phasesC = [];
    videoC.addEventListener("skip-ads-preview-playlist-warm-phase", event => phasesC.push(JSON.parse(event.detail).phase));
    const pendingC = top.primePlaylistPreviewResponse(videoC, "vid00000003", { left: 10, top: 150, width: 100, height: 60 });
    let settledC = false;
    const observedC = pendingC.then(value => ({ value }), error => ({ error })).finally(() => { settledC = true; });
    const backgroundC = posted.at(-1);
    const residentFrame = frames.at(-1);
    const frameCountBeforeSelection = frames.length;
    assert.equal(top.playlistPreviewResponse("vid00000003"), pendingC);
    const priorityFrame = frames.at(-1);
    const priorityC = backgroundC;
    assert.equal(frames.length, frameCountBeforeSelection,
      "selecting the resident frame's active request must not replace it with another cold document");
    assert.equal(priorityFrame, residentFrame);
    assert.equal(priorityC.videoId, "vid00000003");
    assert.equal(frames.filter(frame => frame.isConnected).length, 1,
      "selected upgrade must keep exactly one broker iframe");
    send(priorityFrame, priorityC, "request");
    send(priorityFrame, priorityC, "error");
    await Promise.resolve();
    assert.equal(settledC, false, "one renderer timeout must retry instead of surfacing unavailable");
    const retryFrame = frames.at(-1);
    const retryUrl = new URL(retryFrame.src, location.origin);
    const retriedC = {
      requestId: retryUrl.searchParams.get("skip_inline_preview_broker"),
      videoId: retryUrl.searchParams.get("skip_inline_preview_video"),
    };
    assert.equal(retriedC.videoId, "vid00000003");
    assert.notEqual(retriedC.requestId, priorityC.requestId, "retry must use a fresh request id");
    assert.equal(frames.filter(frame => frame.isConnected).length, 1,
      "renderer retry must replace, rather than multiply, the broker iframe");
    send(retryFrame, retriedC, "response", { videoDetails: { videoId: "vid00000003" }, streamingData: {} });
    assert.deepEqual(await observedC, { value: { videoDetails: { videoId: "vid00000003" }, streamingData: {} } });
    assert.deepEqual(phasesC, ["preparing", "idle"], "a recovered unretained response must return to idle without flashing an error");
    assert.ok(timeoutDelays.includes(5_000),
      "top broker startup watchdog must allow measured broker startup headroom without waiting ten seconds");
    assert.ok(timeoutDelays.includes(4_000),
      "player-response watchdog must allow network variance without retaining the former twelve-second delay");

    const makeObservedPrime = (videoId, topOffset) => {
      const video = makeVideo();
      const phases = [];
      video.addEventListener("skip-ads-preview-playlist-warm-phase", event => phases.push(JSON.parse(event.detail).phase));
      const pending = top.primePlaylistPreviewResponse(video, videoId, { left: 10, top: topOffset, width: 100, height: 60 });
      return { phases, pending, observed: pending.then(value => ({ value }), error => ({ error })) };
    };
    const supersededD = makeObservedPrime("vid00000004", 220);
    const supersededE = makeObservedPrime("vid00000005", 290);
    const currentF = makeObservedPrime("vid00000006", 360);
    for (const prior of [supersededD, supersededE]) {
      assert.match((await prior.observed).error?.message ?? "", /superseded/i);
      assert.deepEqual(prior.phases, ["preparing", "idle"],
        "every older intent must settle idle as soon as ownership changes");
    }
    assert.deepEqual(currentF.phases, ["preparing"], "only the latest intent may remain in preparation");
    void currentF.observed;
    installed.dispose();
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test("a new playlist intent cancels old preparation and ignores its late response", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const listeners = new Map();
  const posted = [];
  let installed;
  try {
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout() { return 1; },
      clearTimeout() {},
    };
    globalThis.window.top = globalThis.window;
    globalThis.location = { origin: "https://www.youtube.com", pathname: "/results", search: "" };
    const frame = {
      dataset: {}, style: {}, isConnected: false,
      contentWindow: { postMessage(message) { posted.push(message); } },
      setAttribute() {}, remove() { this.isConnected = false; },
    };
    globalThis.document = {
      createElement() { return frame; },
      documentElement: { dataset: {}, append(value) { value.isConnected = true; } },
    };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    installed = top.installPlaylistTopBroker();
    const makeVideo = () => Object.assign(new EventTarget(), {
      isConnected: true,
      classList: { contains: name => name === "skip-ads-preview-prototype-video" },
    });
    const videoA = makeVideo();
    const videoB = makeVideo();
    const phasesA = [];
    const phasesB = [];
    videoA.addEventListener("skip-ads-preview-playlist-warm-phase", event => phasesA.push(JSON.parse(event.detail).phase));
    videoB.addEventListener("skip-ads-preview-playlist-warm-phase", event => phasesB.push(JSON.parse(event.detail).phase));

    const pendingA = top.primePlaylistPreviewResponse(videoA, "vid00000001", { left: 10, top: 10, width: 100, height: 60 });
    let settledA = false;
    const observedA = pendingA.then(value => ({ value }), error => ({ error })).finally(() => { settledA = true; });
    listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "online",
    } });
    const requestA = Object.fromEntries(new URL(frame.src, location.origin).searchParams);

    const pendingB = top.primePlaylistPreviewResponse(videoB, "vid00000002", { left: 10, top: 80, width: 100, height: 60 });
    const observedB = pendingB.then(value => ({ value }), error => ({ error }));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settledA, true, "the old hover must settle immediately when a newer intent takes ownership");
    assert.match((await observedA).error?.message ?? "", /superseded/i);
    assert.deepEqual(phasesA, ["preparing", "idle"]);
    assert.equal(posted.at(-1)?.videoId, "vid00000002", "the latest intent must start without waiting behind stale work");
    const requestB = posted.at(-1);

    listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "response",
      requestId: requestA.skip_inline_preview_broker,
      videoId: requestA.skip_inline_preview_video,
      response: { videoDetails: { videoId: "vid00000001" }, streamingData: {} },
    } });
    await Promise.resolve();
    assert.deepEqual(phasesB, ["preparing"], "a late response from the old request must not affect the new intent");

    listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: {
      channel: "skip-ads-preview-playlist-broker", kind: "response",
      requestId: requestB.requestId,
      videoId: requestB.videoId,
      response: { videoDetails: { videoId: "vid00000002" }, streamingData: {} },
    } });
    assert.equal((await observedB).value.videoDetails.videoId, "vid00000002");
    assert.deepEqual(phasesB, ["preparing", "ready"]);
  } finally {
    installed?.dispose();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test("selected renderer-ready stall rewakes the resident frame without another cold start", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const listeners = new Map();
  const frames = [];
  const posted = [];
  const debugEntries = [];
  const timers = new Map();
  let nextTimer = 0;
  let installed;
  try {
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout(callback, delay) {
        const id = ++nextTimer;
        timers.set(id, { callback, delay, cleared: false });
        return id;
      },
      clearTimeout(id) {
        const timer = timers.get(id);
        if (timer) timer.cleared = true;
      },
    };
    globalThis.window.top = globalThis.window;
    globalThis.location = { origin: "https://www.youtube.com", pathname: "/results", search: "" };
    globalThis.document = {
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
        dataset: {},
        getAttribute(name) { return name === "data-skip-preview-debug-log" ? "true" : null; },
        append(frame) { frame.isConnected = true; },
      },
      dispatchEvent(event) {
        if (event.type === "skip-ads-preview-debug-log") debugEntries.push(JSON.parse(event.detail));
        return true;
      },
    };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    installed = top.installPlaylistTopBroker();
    const video = Object.assign(new EventTarget(), {
      isConnected: true,
      classList: { contains: name => name === "skip-ads-preview-prototype-video" },
    });
    const videoId = "vid00000007";
    const pending = top.primePlaylistPreviewResponse(video, videoId, { left: 10, top: 10, width: 100, height: 60 });
    const observed = pending.then(value => ({ value }), error => ({ error }));
    const initialFrame = frames[0];
    const initialUrl = new URL(initialFrame.src, location.origin);
    const initialRequest = {
      channel: "skip-ads-preview-playlist-broker",
      requestId: initialUrl.searchParams.get("skip_inline_preview_broker"),
      videoId,
    };
    listeners.get("message")({ origin: location.origin, source: initialFrame.contentWindow, data: {
      channel: initialRequest.channel, kind: "online",
    } });
    listeners.get("message")({ origin: location.origin, source: initialFrame.contentWindow, data: {
      ...initialRequest, kind: "ready",
    } });
    listeners.get("message")({ origin: location.origin, source: initialFrame.contentWindow, data: {
      ...initialRequest, kind: "invalid", reason: "playability-status", playabilityStatus: "ERROR",
      observedVideoId: videoId, hasStreamingData: false, elapsedMs: 900,
    } });
    assert.equal(debugEntries.some(entry => entry.event === "preview.broker-invalid-response" &&
      entry.detail.reason === "playability-status" && entry.detail.playabilityStatus === "ERROR"), true,
    "an invalid response must reach the persistent top-frame diagnostics");
    const postedBeforePrioritize = posted.length;
    assert.equal(top.playlistPreviewResponse(videoId), pending);
    assert.equal(posted.length, postedBeforePrioritize,
      "clicking a newly ready renderer must not spend its recovery attempt before the phase timeout");

    const recoveryTimer = [...timers.values()].find(timer => !timer.cleared && timer.delay === 1_500);
    assert.ok(recoveryTimer,
      "a selected renderer that never starts a player request must get an early, phase-specific recovery timeout");
    recoveryTimer.callback();
    await Promise.resolve();
    assert.equal(debugEntries.some(entry => entry.event === "preview.prepare-timeout" &&
      entry.detail.progress === "ready" && entry.detail.timeoutMs === 1_500 && entry.detail.willRetry === true &&
      entry.detail.retryScope === "native-hover"), true,
    "watchdog diagnostics must identify the stage, duration, decision, and minimum recovery scope");
    assert.equal(posted.length, postedBeforePrioritize + 1,
      "the renderer should be re-woken only after its phase-specific timeout");
    assert.equal(posted.at(-1)?.kind, "rewake",
      "renderer-ready recovery must repeat only native hover instead of restarting search navigation");

    assert.equal(frames.length, 1, "a slow renderer wake must not pay for another cold YouTube document");
    assert.equal(initialFrame.isConnected, true, "the ready broker document must stay resident while it is rewoken");
    assert.equal(frames.filter(frame => frame.isConnected).length, 1,
      "recovery must never leave more than one broker iframe connected");
    listeners.get("message")({ origin: location.origin, source: initialFrame.contentWindow, data: {
      ...initialRequest, kind: "ready",
    } });
    listeners.get("message")({ origin: location.origin, source: initialFrame.contentWindow, data: {
      ...initialRequest, kind: "request",
    } });
    const responseTimer = [...timers.values()].find(timer => !timer.cleared && timer.delay === 4_000);
    assert.ok(responseTimer, "a player request must use its own four-second response watchdog");
    responseTimer.callback();
    await Promise.resolve();
    assert.equal(frames.length, 2,
      "request-stage recovery must remain available after the independent ready-stage recovery was used");
    assert.equal(initialFrame.isConnected, false);
    const responseFrame = frames[1];
    const responseUrl = new URL(responseFrame.src, location.origin);
    listeners.get("message")({ origin: location.origin, source: responseFrame.contentWindow, data: {
      channel: initialRequest.channel,
      kind: "response",
      requestId: responseUrl.searchParams.get("skip_inline_preview_broker"),
      videoId,
      response: { videoDetails: { videoId }, streamingData: {} },
    } });
    assert.deepEqual(await observed, { value: { videoDetails: { videoId }, streamingData: {} } });
  } finally {
    installed?.dispose();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});

test("rapid playlist selections reuse one heavyweight broker document", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const listeners = new Map();
  const frames = [];
  let installed;
  try {
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout() { return 1; },
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
      documentElement: {
        dataset: {},
        append(frame) { frame.isConnected = true; },
      },
    };

    const top = await importBrowserModule("src/preview-playlist-broker-top.main.ts");
    installed = top.installPlaylistTopBroker();
    const makeVideo = () => Object.assign(new EventTarget(), {
      isConnected: true,
      classList: { contains: name => name === "skip-ads-preview-prototype-video" },
    });

    for (let index = 0; index < 12; index++) {
      const videoId = `rapid${String(index).padStart(6, "0")}`;
      void top.primePlaylistPreviewResponse(makeVideo(), videoId, { left: 10, top: 10 + index * 60, width: 100, height: 50 })
        .catch(() => {});
      top.playlistPreviewResponse(videoId)?.catch(() => {});
    }

    assert.equal(frames.filter(frame => frame.isConnected).length, 1,
      "rapid selection must keep exactly one broker iframe connected");
    assert.equal(frames.length, 1,
      "rapid selection must not allocate one heavyweight YouTube document per click before older documents can be collected");
  } finally {
    installed?.dispose();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});
