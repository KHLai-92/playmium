import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { transform } from "esbuild";
import { nextPlaylistAutoplayVideoId, playlistAutoplayPreparation } from "../src/preview-playlist.ts";

test("production wheel handling preserves overlay scrolling and consumes its boundaries", async () => {
  const source = (await readFile("src/inline-preview.ts", "utf8")).replace(/\r\n/g, "\n");
  const start = source.indexOf('  window.addEventListener("wheel", event => {\n    const activeHost');
  assert.ok(start >= 0);
  const end = source.indexOf('  for (const name of ["touchstart", "touchmove"])', start);
  assert.ok(end > start);
  const { code } = await transform(source.slice(start, end), { loader: "ts" });
  class Node {}
  class HTMLElement extends Node {
    scrollTop = 0; scrollLeft = 0; scrollHeight = 1000; scrollWidth = 100;
    clientHeight = 100; clientWidth = 100;
  }
  const video = new HTMLElement(), overlay = new HTMLElement();
  const host = new HTMLElement(); host.contains = target => target === video;
  const panel = {}, playlistChrome = {};
  let handler;
  runInNewContext(code, {
    window: { addEventListener(name, callback, options) {
      assert.equal(name, "wheel"); assert.equal(options.capture, true); assert.equal(options.passive, false);
      handler = callback;
    } },
    session: { host }, loading: null, supportedPage: () => true,
    Node, HTMLElement, panel, playlistChrome,
    getComputedStyle: target => ({ overflowY: target === overlay ? "auto" : "visible", overflowX: "visible" }),
  });
  function wheel(target, path, changes = {}) {
    const result = { prevented: false, stopped: false };
    handler({ target, deltaY: 200, deltaX: 0, ctrlKey: false, composedPath: () => path,
      preventDefault: () => { result.prevented = true; },
      stopImmediatePropagation: () => { result.stopped = true; }, ...changes });
    return result;
  }
  assert.deepEqual(wheel(video, [video, host]), { prevented: true, stopped: true });
  assert.deepEqual(wheel(overlay, [overlay, panel]), { prevented: false, stopped: true });
  overlay.scrollTop = 900;
  assert.deepEqual(wheel(overlay, [overlay, panel]), { prevented: true, stopped: true });
  assert.deepEqual(wheel(overlay, [overlay, panel], { deltaY: -200 }), { prevented: false, stopped: true });
  overlay.scrollTop = 0;
  assert.deepEqual(wheel(overlay, [overlay, panel], { deltaY: -200 }), { prevented: true, stopped: true });
  assert.deepEqual(wheel(video, [video, host], { ctrlKey: true }), { prevented: false, stopped: false });
  assert.deepEqual(wheel(video, [video, playlistChrome]), { prevented: false, stopped: false });
});

test("production autoplay reuses a ready action and cancels only unfinished next-video preparation", async () => {
  const source = (await readFile("src/inline-preview.ts", "utf8")).replace(/\r\n/g, "\n");
  const start = source.indexOf("  function queuePlaylistAutoplay()");
  const end = source.indexOf('  window.addEventListener("ended"', start);
  assert.ok(start >= 0 && end > start);
  const { code } = await transform(source.slice(start, end) + "\nglobalThis.run = queuePlaylistAutoplay;", { loader: "ts" });
  for (const phase of ["ready", "preparing"]) {
    const cancellations = [], selections = [];
    const video = { ended: true, dispatchEvent: event => cancellations.push(JSON.parse(event.detail)) };
    const context = {
      playlistAutoplay: true, pendingPlaylistSelection: null,
      session: { video, playlistContext: { playlistId: "PL123" }, host: { getBoundingClientRect: () => ({ left: 1, top: 2, width: 300, height: 200 }) } },
      playlist: { currentIndex: 0, items: [{ videoId: "abcdefghijk" }, { videoId: "lmnopqrstuv" }] },
      playlistPreviewStates: new Map([["lmnopqrstuv", phase]]),
      playlistPreviewActions: new Map([["lmnopqrstuv", "prepared-action"]]),
      playlistHoverIntent: { cancel() {} }, cancelPlaylistPrime() {},
      playlistList: { querySelector: () => null }, CSS: { escape: value => value },
      playlistPrefetchCancelEvent: "cancel", emitPreviewDebugLog() {},
      previewSession: { dispatch: selection => selections.push(selection) },
      queueMicrotask: callback => callback(), nextPlaylistAutoplayVideoId, playlistAutoplayPreparation,
      CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    };
    runInNewContext(code, context);
    assert.equal(context.run(), phase === "ready" ? "warm" : "cold");
    assert.equal(selections.length, 1);
    assert.equal(selections[0].videoId, "lmnopqrstuv");
    assert.equal(selections[0].actionId, phase === "ready" ? "prepared-action" : undefined);
    assert.equal(cancellations.length, phase === "ready" ? 0 : 1);
    assert.equal(context.playlistPreviewStates.has("lmnopqrstuv"), phase === "ready");
  }
});
