// Real broker interfaces with pinned timers and offline transport; no user tab.
import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function topFixture(run, search = "") {
  const saved = Object.fromEntries(["window", "document", "location", "clearTimeout"].map(key => [key, globalThis[key]]));
  const listeners = new Map(), timers = new Map(), frames = [], commands = [];
  let sequence = 0;
  const schedule = (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; };
  const clear = id => timers.delete(id);
  let broker;
  try {
    globalThis.window = { top: null, addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: name => listeners.delete(name), setTimeout: schedule, clearTimeout: clear };
    window.top = window;
    globalThis.clearTimeout = clear;
    globalThis.location = { origin: "https://www.youtube.com", href: "https://www.youtube.com/results", pathname: "/results", search };
    globalThis.document = { documentElement: { dataset: {}, append(frame) { frame.isConnected = true; } }, createElement() {
      const navigations = [];
      const frame = { dataset: {}, style: {}, isConnected: false, setAttribute() {}, remove() { this.isConnected = false; },
        contentWindow: { postMessage(value) { commands.push(value); } },
        set src(value) { navigations.push(value); }, get src() { return navigations.at(-1); }, navigations };
      frames.push(frame); return frame;
    } };
    const bundle = await build({ entryPoints: ["src/preview-playlist-broker-top.main.ts"], bundle: true, write: false, format: "esm", platform: "browser" });
    broker = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${Math.random()}`);
    broker.installPlaylistTopBroker();
    const target = () => Object.assign(new EventTarget(), { isConnected: true,
      classList: { contains: name => name === "skip-ads-preview-prototype-video" } });
    const initial = () => {
      const url = new URL(frames.at(-1).src, location.origin);
      return { channel: "skip-ads-preview-playlist-broker", requestId: url.searchParams.get("skip_inline_preview_broker"),
        videoId: url.searchParams.get("skip_inline_preview_video") };
    };
    const message = data => listeners.get("message")({ origin: location.origin, source: frames.at(-1).contentWindow, data });
    const prime = (videoId, actionId = videoId, trigger = "hover") => broker.primePlaylistPreviewResponse(target(), videoId,
      { left: 10, top: 10, width: 100, height: 60 }, { actionId, trigger });
    const searchMode = enabled => listeners.get("skip-ads-preview-search-mode")(
      new CustomEvent("skip-ads-preview-search-mode", { detail: JSON.stringify(enabled) }));
    await run({ broker, prime, message, initial, frames, timers, commands, target, searchMode });
  } finally {
    broker?.disposePlaylistTopBroker();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

test("cold intent switches retain the stable latest-target document navigation", () => topFixture(async f => {
  for (let index = 0; index < 12; index++) void f.prime(`rapid${String(index).padStart(6, "0")}`).catch(() => {});
  assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].navigations.length, 12, "preserve the baseline source update for each cold supersession");
  f.message({ channel: "skip-ads-preview-playlist-broker", kind: "online" });
  assert.equal(f.initial().videoId, "rapid000011");
  assert.equal(f.commands.filter(command => command.kind === "prepare").length, 0);
}));

test("persisted search setting controls iframe mode independently of page URL", async () => {
  await topFixture(async f => {
    void f.prime("-Pk8d6gQccc").catch(() => {});
    const source = new URL(f.frames.at(-1).src, location.origin);
    assert.equal(source.searchParams.get("search_query"), '"-Pk8d6gQccc"');
    assert.equal(source.searchParams.has("skip_inline_preview_search"), false);
    assert.equal(document.documentElement.dataset.skipPreviewBrokerSearch, "id");
  });
  await topFixture(async f => {
    f.searchMode(true);
    globalThis.location.search = ""; // Native canonicalization before the click.
    void f.prime("zvx0SyYEsUA").catch(() => {});
    const source = new URL(f.frames.at(-1).src, location.origin);
    assert.equal(source.searchParams.get("search_query"), "https://www.youtube.com/watch?v=zvx0SyYEsUA");
    assert.equal(source.searchParams.get("skip_inline_preview_search"), "url");
    assert.equal(source.searchParams.get("skip_inline_preview_video"), "zvx0SyYEsUA");
    assert.equal(document.documentElement.dataset.skipPreviewBrokerSearch, "url");
  }, "?skip_inline_preview_search=url");
});

test("switching search mode retires old documents and cached preparation on the next intent", () => topFixture(async f => {
  const pending = f.prime("abcdefghijk");
  const identity = f.initial();
  f.message({ ...identity, kind: "online" });
  f.message({ ...identity, kind: "response", response: { videoDetails: { videoId: identity.videoId }, streamingData: {} } });
  await pending;
  assert.ok(f.broker.readyPlaylistPreviewResponse(identity.videoId));
  f.searchMode(true);
  assert.equal(f.broker.readyPlaylistPreviewResponse(identity.videoId), null);
  assert.equal(f.frames[0].isConnected, true, "changing a setting does not interrupt current work");
  void f.prime("zvx0SyYEsUA").catch(() => {});
  assert.equal(f.frames[0].isConnected, false);
  assert.equal(new URL(f.frames.at(-1).src, location.origin).searchParams.get("search_query"), "https://www.youtube.com/watch?v=zvx0SyYEsUA");
  f.searchMode(false);
  void f.prime("zvx0SyYEsUA", "next-click").catch(() => {});
  assert.equal(new URL(f.frames.at(-1).src, location.origin).searchParams.get("search_query"), "zvx0SyYEsUA");
}));

test("search setting waits for a new intent while active preparation finishes", () => topFixture(async f => {
  const pending = f.prime("abcdefghijk");
  const identity = f.initial();
  f.message({ ...identity, kind: "online" });
  f.searchMode(true);
  assert.equal(f.frames[0].isConnected, true);
  f.message({ ...identity, kind: "response", response: { videoDetails: { videoId: identity.videoId }, streamingData: {} } });
  assert.equal((await pending).videoDetails.videoId, identity.videoId);
  assert.equal(f.broker.readyPlaylistPreviewResponse(identity.videoId), null, "old mode completion is not cached after the choice changed");
}));

test("request progress cannot regress or reset its deadline on duplicate messages", () => topFixture(async f => {
  void f.prime("abcdefghijk").catch(() => {});
  const identity = f.initial();
  f.message({ ...identity, kind: "online" });
  f.message({ ...identity, kind: "request" });
  const deadline = [...f.timers.entries()].find(([, timer]) => timer.delay === 4000);
  assert.ok(deadline);
  for (const kind of ["ready", "request", "ready", "request"]) f.message({ ...identity, kind });
  assert.equal(f.timers.get(deadline[0]), deadline[1], "a native request has one deadline, not a rolling duplicate-message deadline");
  assert.equal([...f.timers.values()].some(timer => timer.delay === 1500), false);
}));

test("completion quiesces the resident broker; response expiry does not retire its document", () => topFixture(async f => {
  const pending = f.prime("abcdefghijk");
  const identity = f.initial();
  f.message({ ...identity, kind: "online" });
  const response = { videoDetails: { videoId: "abcdefghijk" }, streamingData: {} };
  f.message({ ...identity, kind: "response", response });
  assert.deepEqual(await pending, response);
  assert.equal(f.commands.length, 0, "the frame completes its own job; top completion does not issue a new command");
  const retentionTimers = [...f.timers.values()].filter(timer => timer.delay === 30000);
  assert.equal(retentionTimers.length, 1, "only completed responses expire; idle is not evidence that the document is unusable");
  retentionTimers[0].callback();
  assert.equal(f.frames[0].isConnected, true);
  assert.equal(f.broker.readyPlaylistPreviewResponse("abcdefghijk"), null);
}));

test("long preview sequences reuse one document without changing response capacity", () => topFixture(async f => {
  for (let index = 0; index < 24; index++) {
    const id = `video${String(index).padStart(6, "0")}`;
    const pending = f.prime(id);
    f.message({ channel: "skip-ads-preview-playlist-broker", kind: "online" });
    const identity = f.commands.at(-1)?.kind === "prepare" ? f.commands.at(-1) : f.initial();
    f.message({ ...identity, kind: "response", response: { videoDetails: { videoId: id }, streamingData: {} } });
    await pending;
    assert.equal(f.frames.filter(frame => frame.isConnected).length, 1);
    if (index > 0) assert.equal(f.broker.readyPlaylistPreviewResponse(`video${String(index - 1).padStart(6, "0")}`), null);
    assert.equal(f.broker.readyPlaylistPreviewResponse(id).videoDetails.videoId, id);
  }
  assert.equal(f.frames.length, 1, "completed job count does not establish a need to allocate another YouTube document");
}));

test("same-video repetition replaces its consumed document and ready retry preserves native rewake", () => topFixture(async f => {
  const id = "abcdefghijk";
  const pending = f.prime(id);
  f.message({ ...f.initial(), kind: "online" });
  f.message({ ...f.initial(), kind: "response", response: { videoDetails: { videoId: id }, streamingData: {} } });
  await pending;
  f.broker.playlistPreviewResponse(id);
  void f.prime(id, "repeat").catch(() => {});
  assert.equal(f.frames.length, 2, "preserve stable consumed-video document replacement");
  const repeated = f.initial();
  f.message({ ...repeated, kind: "online" });
  f.message({ ...repeated, kind: "ready" });
  [...f.timers.values()].find(timer => timer.delay === 1500).callback();
  assert.equal(f.frames.length, 2);
  assert.equal(f.commands.at(-1).kind, "rewake", "preserve stable native-hover recovery");
  assert.equal(f.commands.at(-1).requestId, repeated.requestId);
}));

test("starting failures retain bounded document replacement", () => topFixture(async f => {
  void f.prime("abcdefghijk", "fallback").catch(() => {});
  [...f.timers.values()].find(timer => timer.delay === 5000).callback();
  assert.equal(f.frames.length, 2);
  assert.equal(f.frames[0].isConnected, false);
  f.message({ ...f.initial(), kind: "online" });
  // A new action owns its own retry budget; the previous bootstrap retry did
  // not prove that this online document is unusable.
  void f.prime("bbbbbbbbbbb", "search-form").catch(() => {});
  f.message({ ...f.commands.at(-1), kind: "error", stage: "spa-navigation", error: "search-form-unavailable" });
  assert.equal(f.frames.length, 3);
  assert.equal(f.frames.filter(frame => frame.isConnected).length, 1);
}));

test("a cancelled cold bootstrap is stopped when it finally comes online", () => topFixture(async f => {
  const observed = f.prime("abcdefghijk", "cold-cancel").catch(error => error);
  const identity = f.initial();
  f.broker.cancelPlaylistPreviewResponse("abcdefghijk", "cold-cancel");
  assert.match((await observed).message, /superseded/);
  const beforeOnline = f.commands.length;
  f.message({ channel: "skip-ads-preview-playlist-broker", kind: "online" });
  assert.equal(f.commands.length, beforeOnline + 1, "cancel sent before document load is lossy and must be repeated on handshake");
  assert.deepEqual(f.commands.at(-1), { ...identity, kind: "cancel" });
  f.message({ ...identity, kind: "response", response: { videoDetails: { videoId: "abcdefghijk" }, streamingData: {} } });
  assert.equal(f.broker.readyPlaylistPreviewResponse("abcdefghijk"), null);
}));

test("a clicked pending preparation transfers cancellation and phase ownership", () => topFixture(async f => {
  const original = f.target(), player = f.target();
  const oldSignal = new AbortController(), newSignal = new AbortController();
  const pending = f.broker.primePlaylistPreviewResponse(original, "abcdefghijk", {
    left: 10, top: 10, width: 100, height: 60,
  }, { actionId: "transfer", trigger: "hover", signal: oldSignal.signal });
  let settled = false;
  const observed = pending.finally(() => { settled = true; });
  const identity = f.initial();
  f.message({ ...identity, kind: "online" });
  f.message({ ...identity, kind: "ready" });
  assert.equal(f.broker.playlistPreviewResponse("abcdefghijk", "transfer", { target: player, signal: newSignal.signal }), pending);
  oldSignal.abort(); original.dispatchEvent(new Event("ended"));
  await Promise.resolve(); assert.equal(settled, false);
  const response = { videoDetails: { videoId: "abcdefghijk" }, streamingData: {} };
  f.message({ ...identity, kind: "response", response });
  assert.deepEqual(await observed, response);
  assert.equal(f.broker.readyPlaylistPreviewResponse("abcdefghijk"), null, "selected response is not retained a second time");
}));

test("closing the transferred player cancels the shared physical request", () => topFixture(async f => {
  const pending = f.prime("abcdefghijk", "transfer-close").catch(error => error);
  const controller = new AbortController();
  f.broker.playlistPreviewResponse("abcdefghijk", "transfer-close", { target: f.target(), signal: controller.signal });
  controller.abort();
  assert.match((await pending).message, /superseded/);
  assert.equal(f.commands.at(-1).kind, "cancel");
}));

test("final ready timeout stops physical work without replacing the resident iframe or extending retries", () => topFixture(async f => {
  const observed = f.prime("abcdefghijk", "exhausted-ready").catch(error => error);
  const identity = f.initial();
  f.message({ ...identity, kind: "online" });
  for (let attempt = 0; attempt < 3; attempt++) {
    f.message({ ...identity, kind: "ready" });
    const deadline = [...f.timers.values()].find(timer => timer.delay === 1500);
    assert.ok(deadline);
    deadline.callback();
  }
  assert.match((await observed).message, /timed out/);
  assert.equal(f.commands.filter(command => command.kind === "rewake").length, 2);
  assert.deepEqual(f.commands.at(-1), { ...identity, kind: "cancel" }, "terminal rejection must retire the frame job that top no longer owns");
  assert.equal(f.frames.length, 1);
  assert.equal(f.frames[0].isConnected, true);
  assert.equal(f.timers.size, 0);
  f.message({ ...identity, kind: "response", response: { videoDetails: { videoId: identity.videoId }, streamingData: {} } });
  assert.equal(f.broker.readyPlaylistPreviewResponse(identity.videoId), null);
}));
