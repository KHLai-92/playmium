import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function importBrowserModule(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${Date.now()}`);
}

test("playlist broker honors the persisted per-stage retry limit", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const listeners = new Map();
  const frames = [];
  const timeoutDelays = [];
  let installed;
  try {
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.window = {
      top: null,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
      setTimeout(_callback, delay) { timeoutDelays.push(delay); return timeoutDelays.length; },
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
    installed = top.installPlaylistTopBroker();
    const video = Object.assign(new EventTarget(), {
      isConnected: true,
      classList: { contains: name => name === "playmium-preview-video" },
    });
    const videoId = "vid00000021";
    const pending = top.primePlaylistPreviewResponse(video, videoId, { left: 10, top: 10, width: 100, height: 60 }, {
      actionId: "retry-limit-two", trigger: "click", retryLimit: 2,
      timeoutMultipliers: { starting: .5, ready: 2, request: 3 },
    });
    const observed = pending.then(value => ({ value }), error => ({ error }));

    const failRequestStage = frame => {
      const url = new URL(frame.src, location.origin);
      const identity = {
        channel: "skip-ads-preview-playlist-broker",
        requestId: url.searchParams.get("skip_inline_preview_broker"),
        videoId,
      };
      listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: { ...identity, kind: "ready" } });
      listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: { ...identity, kind: "request" } });
      listeners.get("message")({ origin: location.origin, source: frame.contentWindow, data: { ...identity, kind: "error", error: "failed" } });
    };

    failRequestStage(frames[0]);
    failRequestStage(frames[1]);
    assert.equal(frames.length, 3, "two retries should create two replacement broker documents");
    failRequestStage(frames[2]);
    assert.match((await observed).error?.message ?? "", /renderer did not become ready/i);
    assert.equal(frames.length, 3, "the third stage failure must stop at the configured limit");
    assert.ok(timeoutDelays.includes(2_500), "starting stage should use 0.5 × 5 seconds");
    assert.ok(timeoutDelays.includes(3_000), "ready stage should use 2 × 1.5 seconds");
    assert.ok(timeoutDelays.includes(12_000), "request stage should use 3 × 4 seconds");
  } finally {
    installed?.dispose();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location; else globalThis.location = originalLocation;
  }
});
