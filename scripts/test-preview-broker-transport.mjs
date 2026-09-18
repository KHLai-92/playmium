// Native transport ownership through the actual frame module, without a browser.
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/preview-playlist-broker-frame.main.ts"], bundle: true, write: false, format: "esm", platform: "node" });
const { installPlaylistFrameBroker } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const videoId = "abcdefghijk";

async function fixture(run, { blurred = false } = {}) {
  const keys = ["window", "document", "parent", "location", "MutationObserver", "XMLHttpRequest", "PointerEvent", "MouseEvent", "Element", "HTMLMediaElement", "clearTimeout"];
  const saved = Object.fromEntries(keys.map(key => [key, globalThis[key]]));
  const messages = [], requests = [], timers = new Map(), observers = [];
  let sequence = 0;
  const schedule = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; };
  const clear = id => timers.delete(id);
  class Surface extends EventTarget {
    isConnected = true; dataset = {}; parentElement = null;
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 60 }; }
  }
  class Media extends Surface { paused = false; pause() { this.paused = true; } }
  class Xhr extends EventTarget {
    aborted = false; responseType = "json"; response = null;
    open() {} send() {} abort() { this.aborted = true; this.dispatchEvent(new Event("loadend")); }
  }
  try {
    globalThis.clearTimeout = clear;
    globalThis.location = { origin: "https://www.youtube.com", pathname: "/results",
      search: `?search_query=${videoId}&skip_inline_preview_broker=transport&skip_inline_preview_video=${videoId}` };
    globalThis.parent = { postMessage(message) { messages.push(message); } };
    globalThis.window = Object.assign(new EventTarget(), { fetch: (_input, init) => {
      let resolve; const promise = new Promise(supplied => { resolve = supplied; });
      requests.push({ signal: init?.signal, resolve }); return promise;
    }, setTimeout: schedule, clearTimeout: clear });
    globalThis.Element = Surface; globalThis.HTMLMediaElement = Media;
    globalThis.XMLHttpRequest = Xhr;
    globalThis.PointerEvent = class extends Event {}; globalThis.MouseEvent = class extends Event {};
    globalThis.MutationObserver = class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() { this.active = true; } disconnect() { this.active = false; }
    };
    const thumbnail = new Surface(), renderer = new Surface(); thumbnail.parentElement = renderer;
    let unplayable = blurred, blurClicks = 0;
    const blurButton = new Surface(), blurChip = new Surface();
    blurChip.textContent = "關閉模糊效果";
    blurChip.hasAttribute = () => !unplayable;
    blurChip.querySelector = () => blurButton;
    blurButton.click = () => {
      const event = new Event("click", { cancelable: true });
      Object.defineProperty(event, "target", { value: blurButton });
      document.dispatchEvent(event);
      if (!event.defaultPrevented) blurClicks++;
    };
    renderer.querySelector = selector => selector === "ytd-thumbnail-overlay-inline-unplayable-renderer"
      ? (unplayable ? new Surface() : null) : thumbnail;
    renderer.querySelectorAll = () => [{ href: `https://www.youtube.com/watch?v=${videoId}` }];
    globalThis.document = Object.assign(new EventTarget(), { readyState: "complete", documentElement: {}, head: { append() {} },
      createElement: () => ({}), querySelectorAll: selector =>
        selector === "yt-chip-cloud-chip-renderer" ? (blurred ? [blurChip] : []) :
        selector === "ytd-video-renderer,yt-lockup-view-model" || selector === "[data-inline-preview-broker]" ? [renderer] : [] });
    assert.equal(installPlaylistFrameBroker(), true);
    timers.values().find(timer => timer.delay === 0)?.callback();
    const cancel = () => {
      const event = new Event("message");
      Object.assign(event, { origin: location.origin, source: parent,
        data: { channel: "skip-ads-preview-playlist-broker", kind: "cancel", requestId: "transport", videoId } });
      window.dispatchEvent(event);
    };
    const updateBlurredCard = () => {
      unplayable = false;
      for (const observer of observers.filter(item => item.active)) observer.callback([{ addedNodes: [] }]);
    };
    await run({ requests, messages, timers, observers, cancel, Media, updateBlurredCard, blurClicks: () => blurClicks });
    window.dispatchEvent(new Event("pagehide"));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("a blurred BEGOOD card disables blur before waking the updated native preview", () => fixture(async f => {
  assert.equal(f.blurClicks(), 1, "the broker's click guard must allow its own blur control");
  assert.equal(f.messages.some(message => message.kind === "ready"), false);
  assert.equal([...f.timers.values()].some(timer => timer.delay === 0), false, "do not wake the blurred card");
  f.observers.filter(item => item.active).forEach(item => item.callback([{ addedNodes: [] }]));
  assert.equal(f.blurClicks(), 1, "mutations cannot repeatedly click the control");
  f.updateBlurredCard();
  assert.equal(f.messages.filter(message => message.kind === "ready").length, 1);
  f.timers.values().find(timer => timer.delay === 0).callback();
  const pending = window.fetch("/youtubei/v1/player", { body: JSON.stringify({ videoId }) });
  f.requests[0].resolve({ clone: () => ({ json: async () => ({ videoDetails: { videoId }, playabilityStatus: { status: "OK" }, streamingData: {} }) }) });
  await pending; await flush();
  assert.equal(f.messages.filter(message => message.kind === "response").length, 1);
}, { blurred: true }));

test("leaving while the blurred card updates prevents late wake and releases preparation work", () => fixture(async f => {
  assert.equal(f.blurClicks(), 1);
  f.cancel();
  f.updateBlurredCard();
  assert.equal(f.messages.some(message => message.kind === "ready"), false);
  assert.equal(f.timers.size, 0);
  assert.equal(f.observers.filter(item => item.active).length, 1, "only the document media guard remains");
}, { blurred: true }));

test("v86 timing observes an opaque fetch once without claiming its transport or stopping wakes", () => fixture(async f => {
  const body = new FormData(); body.set("videoId", videoId);
  const pending = window.fetch("/youtubei/v1/player", { body });
  assert.equal(f.messages.filter(message => message.kind === "request-observed").length, 1);
  assert.equal(f.messages.filter(message => message.kind === "request").length, 0);
  assert.equal(f.requests[0].signal, undefined);
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [0, 100, 300, 700, 1200]);
  void window.fetch("/youtubei/v1/player", { body: JSON.stringify({ videoId }) });
  assert.equal(f.messages.filter(message => message.kind === "request-observed").length, 1, "fetch and XHR share v86's first-request marker");
  assert.equal(f.messages.filter(message => message.kind === "request").length, 1);
  f.requests[0].resolve({ clone: () => ({ json: async () => ({ videoDetails: { videoId }, playabilityStatus: { status: "OK" }, streamingData: {} }) }) });
  await pending; await flush();
  assert.equal(f.messages.filter(message => message.kind === "response").length, 1);
}));

test("v86 timing observes opaque XHR and shares its marker with fetch", () => fixture(async f => {
  const body = new FormData(); body.set("videoId", videoId);
  const xhr = new XMLHttpRequest(); xhr.open("POST", "/youtubei/v1/player"); xhr.send(body);
  void window.fetch("/youtubei/v1/player", { body });
  assert.equal(f.messages.filter(message => message.kind === "request-observed").length, 1);
  assert.equal(f.messages.filter(message => message.kind === "request").length, 0);
  f.cancel(); assert.equal(xhr.aborted, false, "timing observation cannot claim opaque network work");
}));

test("pre-ready cancellation aborts target fetch and rejects its late response without removing the document", () => fixture(async f => {
  const pending = window.fetch("/youtubei/v1/player", { body: JSON.stringify({ videoId }) });
  f.cancel(); assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve({ clone: () => ({ json: async () => ({ videoDetails: { videoId }, playabilityStatus: { status: "OK" }, streamingData: {} }) }) });
  await pending; await flush();
  assert.equal(f.messages.filter(message => message.kind === "response").length, 0);
  assert.equal(f.timers.size, 0, "all hover/discovery timers are released");
  const late = new f.Media(); f.observers[0].callback([{ addedNodes: [late] }]);
  assert.equal(late.paused, true); assert.equal(late.muted, true);
}));

test("target fetch preserves caller cancellation and leaves unrelated requests unowned", () => fixture(async f => {
  const controller = new AbortController();
  void window.fetch("/youtubei/v1/player", { body: JSON.stringify({ videoId }), signal: controller.signal });
  void window.fetch("/youtubei/v1/player", { body: JSON.stringify({ videoId: "lmnopqrstuv" }) });
  controller.abort();
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal, undefined);
  f.cancel();
}));

test("target XHR is physically aborted while another video's XHR is left untouched", () => fixture(async f => {
  const target = new XMLHttpRequest(); target.open("POST", "/youtubei/v1/player"); target.send(JSON.stringify({ videoId }));
  const other = new XMLHttpRequest(); other.open("POST", "/youtubei/v1/player"); other.send(JSON.stringify({ videoId: "lmnopqrstuv" }));
  f.cancel(); assert.equal(target.aborted, true); assert.equal(other.aborted, false);
  target.response = { videoDetails: { videoId }, playabilityStatus: { status: "OK" }, streamingData: {} };
  target.dispatchEvent(new Event("load")); await flush();
  assert.equal(f.messages.filter(message => message.kind === "response").length, 0);
}));

test("unrelated native player requests cannot consume target hover wake attempts", () => fixture(async f => {
  void window.fetch("/youtubei/v1/player", { body: JSON.stringify({ videoId: "lmnopqrstuv" }) });
  assert.equal(f.messages.filter(message => message.kind === "request").length, 0);
  assert.deepEqual([...f.timers.values()].map(timer => timer.delay), [0, 100, 300, 700, 1200]);
  f.cancel();
}));
