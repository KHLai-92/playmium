import assert from "node:assert/strict";
import test from "node:test";
import { createPlaylistHoverIntent } from "../src/preview-playlist-hover.ts";

function harness() {
  let timer = null;
  const calls = [];
  const intent = createPlaylistHoverIntent({
    schedule(callback, milliseconds) { timer = { callback, milliseconds }; return timer; },
    cancel(candidate) { if (timer === candidate) timer = null; },
  });
  return {
    calls,
    intent,
    pendingDelay: () => timer?.milliseconds ?? null,
    finish() { const pending = timer; timer = null; pending?.callback(); },
    enter(videoId) { intent.enter(videoId, () => calls.push(videoId)); },
  };
}

test("wheel or scroll activity cancels hover-only playlist preparation", () => {
  const run = harness();
  run.enter("video-one");
  assert.equal(run.pendingDelay(), 100);
  run.intent.cancel();
  run.finish();
  assert.deepEqual(run.calls, []);
});

test("scroll settling prepares the row now beneath a stationary pointer", () => {
  const run = harness();
  let hoveredVideoId = "video-one";
  run.enter(hoveredVideoId);

  hoveredVideoId = "video-two";
  run.intent.settleAfterActivity(() => ({
    videoId: hoveredVideoId,
    action: () => run.calls.push(hoveredVideoId),
  }));

  assert.equal(run.pendingDelay(), 100);
  run.finish();
  assert.deepEqual(run.calls, ["video-two"]);
});

test("only a stable final playlist hover starts preparation", () => {
  const run = harness();
  run.enter("video-one");
  run.enter("video-two");
  run.intent.leave("video-one");
  run.finish();
  assert.deepEqual(run.calls, ["video-two"]);
});

test("leaving the pending playlist row cancels preparation", () => {
  const run = harness();
  run.enter("video-one");
  run.intent.leave("video-one");
  run.finish();
  assert.deepEqual(run.calls, []);
});
