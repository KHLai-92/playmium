import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { PageBridgeError, createDomPageBridge, createInMemoryPageBridge } from "../src/preview-page-bridge.ts";

async function importBrowserModule(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${Date.now()}`);
}

test("page bridge adapters share request results, validation, cancellation, and timeout semantics", async () => {
  const memory = createInMemoryPageBridge({ echo: async input => ({ value: input.value + 1 }) });
  assert.deepEqual(await memory.request({}, "echo", { value: 4 }), { value: 5 });

  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const target = new EventTarget();
  target.addEventListener("request", event => {
    const request = JSON.parse(event.detail);
    target.dispatchEvent(new CustomEvent("response", { detail: JSON.stringify({ requestId: request.requestId, output: { value: request.input.value + 1 } }) }));
  });
  const dom = createDomPageBridge({
    echo: { requestEvent: "request", responseEvent: "response", timeoutMs: 20, validate: value => typeof value?.value === "number" },
  }, { CustomEvent });
  assert.deepEqual(await dom.request(target, "echo", { value: 8 }), { value: 9 });

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(dom.request(target, "echo", { value: 1 }, { signal: controller.signal }), error => error instanceof PageBridgeError && error.code === "cancelled");
  const silent = createDomPageBridge({ echo: { requestEvent: "never", responseEvent: "never-response", timeoutMs: 1, validate: () => true } }, { CustomEvent });
  await assert.rejects(silent.request(target, "echo", { value: 1 }), error => error instanceof PageBridgeError && error.code === "timeout");
});

test("an in-memory request rejects promptly when it is cancelled during handler work", async () => {
  let finish;
  const bridge = createInMemoryPageBridge({
    slow: () => new Promise(resolve => { finish = resolve; }),
  });
  const controller = new AbortController();
  const request = bridge.request({}, "slow", {}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(Promise.race([
    request,
    new Promise((_, reject) => setTimeout(() => reject(new Error("cancellation did not settle the request")), 20)),
  ]), error => error instanceof PageBridgeError && error.code === "cancelled");
  finish({ value: "late" });
});

test("the DOM adapter exposes typed progress without completing the request early", async () => {
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const target = new EventTarget();
  target.addEventListener("request", event => {
    const request = JSON.parse(event.detail);
    target.dispatchEvent(new CustomEvent("response", { detail: JSON.stringify({ requestId: request.requestId, progress: true, output: { phase: "commit" } }) }));
    target.dispatchEvent(new CustomEvent("response", { detail: JSON.stringify({ requestId: request.requestId, output: { phase: "success" } }) }));
  });
  const progress = [];
  const bridge = createDomPageBridge({
    select: { requestEvent: "request", responseEvent: "response", timeoutMs: 20,
      validate: value => ["commit", "success"].includes(value?.phase) },
  }, { CustomEvent });
  const result = await bridge.request(target, "select", {}, { onProgress: value => progress.push(value) });
  assert.deepEqual(progress, [{ phase: "commit" }]);
  assert.deepEqual(result, { phase: "success" });
});

test("the in-memory adapter exposes the same typed progress contract", async () => {
  const progress = [];
  const bridge = createInMemoryPageBridge({
    select: async (_input, _target, context) => {
      context.progress({ phase: "commit" });
      await Promise.resolve();
      return { phase: "success" };
    },
  });

  const result = await bridge.request({}, "select", {}, { onProgress: value => progress.push(value) });
  assert.deepEqual(progress, [{ phase: "commit" }]);
  assert.deepEqual(result, { phase: "success" });
});

test("playlist load keeps listening past a provisional seed and completes on the final response", async () => {
  const { previewPageOperations } = await importBrowserModule("src/preview-page-operations.ts");
  const disposition = previewPageOperations["playlist-load"].legacyResponseDisposition;
  assert.equal(disposition({ playlistId: "RDabcdefghijk", items: [{}, {}], provisional: true }), "ignore");
  assert.equal(disposition({ playlistId: "RDabcdefghijk", items: [{}, {}, {}] }), "final");
});

test("a playlist prime treats ready as progress and ends when the retained response returns idle", async () => {
  const { previewPageOperations } = await importBrowserModule("src/preview-page-operations.ts");
  const disposition = previewPageOperations["playlist-prime"].legacyResponseDisposition;
  assert.equal(disposition({ phase: "preparing" }), "progress");
  assert.equal(disposition({ phase: "ready" }), "progress");
  assert.equal(disposition({ phase: "idle" }), "final");
  assert.equal(disposition({ phase: "error" }), "final");
});

test("playlist selection bridge outlives one conservative broker retry", async () => {
  const { previewPageOperations } = await importBrowserModule("src/preview-page-operations.ts");
  assert.equal(previewPageOperations["playlist-select"].timeoutMs, 30_000);
});

test("page operation validators reject shallow rich responses", async () => {
  const { previewPageOperations } = await importBrowserModule("src/preview-page-operations.ts");
  for (const name of ["quality", "captions", "metadata", "info"])
    assert.equal(previewPageOperations[name].validate({ source: "blob:current" }), false, `${name} accepted a source-only payload`);

  assert.equal(previewPageOperations.quality.validate({ source: "blob:current", available: ["hd1080"], current: "hd1080",
    requested: null, requestedAt: 0, supported: true, error: "" }), true);
  assert.equal(previewPageOperations.captions.validate({ source: "blob:current", enabled: false, available: false,
    nativeSupported: true, error: "", tracks: [], selectedTrack: "", languageSupported: true,
    translations: [], translation: "" }), true);
  assert.equal(previewPageOperations.metadata.validate({ source: "blob:current", videoId: "vid00000001", chapters: [], error: "" }), true);
  assert.equal(previewPageOperations.info.validate({ source: "blob:current", videoId: "vid00000001", requestId: 1, error: "" }), true);
  assert.equal(previewPageOperations.info.validate({ source: "blob:current", videoId: "vid00000001", requestId: 1, error: "",
    description: { title: "Title", author: "Author", views: "1", published: "today", runs: [{}] } }), false);
  assert.equal(previewPageOperations["playlist-load"].validate({ source: "blob:current", videoId: "vid00000001",
    playlistId: "PL123", items: [] }), false, "playlist load accepted a partial playlist");
  assert.equal(previewPageOperations["playlist-load"].validate({ source: "blob:current", videoId: "vid00000001",
    playlistId: "PL123", title: "Playlist", currentIndex: 0, items: [], error: "" }), true);
});

test("a stale playlist prime cannot publish phases into a newer same-video action", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const surface = new EventTarget();
  try {
    globalThis.window = { top: null };
    globalThis.window.top = globalThis.window;
    globalThis.document = surface;
    globalThis.CustomEvent = CustomEvent;
    const { installPreviewPageBridge } = await importBrowserModule("src/preview-page-bridge.main.ts");
    const { previewPageOperations } = await importBrowserModule("src/preview-page-operations.ts");
    const installed = installPreviewPageBridge();
    const config = previewPageOperations["playlist-prime"];
    const bridge = createDomPageBridge({ prime: config }, { CustomEvent });
    const input = (videoId, actionId) => ({ actionId, startedAtMs: 0, trigger: "hover", videoId, playlistId: "PL123",
      rect: { left: 0, top: 0, width: 100, height: 60 } });
    const progressA = [];
    const progressB = [];
    let settledB = false;
    const requestA = bridge.request(surface, "prime", input("vid00000001", "action-a"), { onProgress: value => progressA.push(value) });
    const requestB = bridge.request(surface, "prime", input("vid00000001", "action-b"), { onProgress: value => progressB.push(value) });
    void requestB.then(() => { settledB = true; });

    surface.dispatchEvent(new CustomEvent(config.legacyResponseEvent, {
      detail: JSON.stringify({ actionId: "action-a", trigger: "hover", videoId: "vid00000001", phase: "idle" }),
    }));
    assert.deepEqual(await requestA, { actionId: "action-a", trigger: "hover", videoId: "vid00000001", phase: "idle" });
    await Promise.resolve();
    assert.equal(settledB, false, "the old action's idle phase incorrectly completed the newer same-video prime");

    surface.dispatchEvent(new CustomEvent(config.legacyResponseEvent, {
      detail: JSON.stringify({ actionId: "action-b", trigger: "hover", videoId: "vid00000001", phase: "ready" }),
    }));
    surface.dispatchEvent(new CustomEvent(config.legacyResponseEvent, {
      detail: JSON.stringify({ actionId: "action-b", trigger: "hover", videoId: "vid00000001", phase: "idle" }),
    }));
    assert.deepEqual(await requestB, { actionId: "action-b", trigger: "hover", videoId: "vid00000001", phase: "idle" });
    assert.deepEqual(progressA, []);
    assert.deepEqual(progressB, [{ actionId: "action-b", trigger: "hover", videoId: "vid00000001", phase: "ready" }]);
    installed.dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = originalCustomEvent;
  }
});

test("a stale playlist selection cannot complete a newer selection", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalCustomEvent = globalThis.CustomEvent;
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const surface = new EventTarget();
  try {
    globalThis.window = { top: null };
    globalThis.window.top = globalThis.window;
    globalThis.document = surface;
    globalThis.CustomEvent = CustomEvent;
    const { installPreviewPageBridge } = await importBrowserModule("src/preview-page-bridge.main.ts");
    const { previewPageOperations } = await importBrowserModule("src/preview-page-operations.ts");
    const installed = installPreviewPageBridge();
    const config = previewPageOperations["playlist-select"];
    const bridge = createDomPageBridge({ select: config }, { CustomEvent });
    const input = (videoId, actionId, requestId) => ({ source: "blob:current", actionId, startedAtMs: 0,
      videoId, playlistId: "PL123", requestId, retentionCapacity: 1, retryLimit: 3,
      timeoutMultipliers: { starting: 1, ready: 1, request: 1 }, rect: { left: 0, top: 0, width: 100, height: 60 } });
    const output = (videoId, actionId, requestId) => ({ source: `blob:${videoId}`, actionId, videoId,
      playlistId: "PL123", requestId, phase: "success" });
    const requestA = bridge.request(surface, "select", input("vid00000001", "action-a", "selection-a"));
    const requestB = bridge.request(surface, "select", input("vid00000002", "action-b", "selection-b"));
    let settledB = false;
    void requestB.then(() => { settledB = true; }, () => { settledB = true; });

    const outputA = output("vid00000001", "action-a", "selection-a");
    surface.dispatchEvent(new CustomEvent(config.legacyResponseEvent, { detail: JSON.stringify(outputA) }));
    assert.deepEqual(await requestA, outputA);
    await Promise.resolve();
    assert.equal(settledB, false, "the old selection incorrectly completed the newer request");

    surface.dispatchEvent(new CustomEvent(config.legacyResponseEvent, {
      detail: JSON.stringify({ ...outputA, phase: "malformed" }),
    }));
    await Promise.resolve();
    assert.equal(settledB, false, "an invalid response from the old selection incorrectly rejected the newer request");

    const outputB = output("vid00000002", "action-b", "selection-b");
    surface.dispatchEvent(new CustomEvent(config.legacyResponseEvent, { detail: JSON.stringify(outputB) }));
    assert.deepEqual(await requestB, outputB);
    installed.dispose();
  } finally {
    if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalCustomEvent === undefined) delete globalThis.CustomEvent; else globalThis.CustomEvent = originalCustomEvent;
  }
});
