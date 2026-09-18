import assert from "node:assert/strict";
import test from "node:test";
import { createPlaylistScrollDiagnostics } from "../src/preview-scroll-diagnostics.ts";

function harness() {
  let now = 1000;
  let timer = null;
  const results = [];
  const diagnostics = createPlaylistScrollDiagnostics({
    now: () => now,
    schedule(callback) { timer = callback; return 1; },
    cancel() { timer = null; },
    onBurst(result) { results.push(result); },
  });
  const wheel = (deltaY, scrollTop = 100) => diagnostics.wheel({
    deltaX: 0, deltaY, deltaMode: 0, clientX: 1100, clientY: 500,
    target: "button.playlist-item", path: ["button.playlist-item", "div#playlist-items"], isTrusted: true,
  }, { scrollTop, scrollHeight: 1000, clientHeight: 300 });
  return {
    diagnostics,
    results,
    wheel,
    finish(milliseconds = 200, snapshot = { scrollTop: 100, scrollHeight: 1000, clientHeight: 300 }) {
      now += milliseconds;
      const callback = timer;
      timer = null;
      callback?.();
      diagnostics.flush(snapshot);
    },
  };
}

test("wheel input with remaining range and no scroll is classified as stalled", () => {
  const run = harness();
  run.wheel(120);
  run.diagnostics.noteDisposition(true, true);
  run.finish();
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].outcome, "stalled");
  assert.equal(run.results[0].expectedMovement, true);
  assert.equal(run.results[0].movementPx, 0);
  assert.equal(run.results[0].defaultPreventedEvents, 1);
  assert.equal(run.results[0].propagationStoppedEvents, 1);
});
test("real movement and an end boundary are not reported as stalled", () => {
  const moving = harness();
  moving.wheel(120);
  moving.diagnostics.scroll({ scrollTop: 180, scrollHeight: 1000, clientHeight: 300 });
  moving.finish(200, { scrollTop: 180, scrollHeight: 1000, clientHeight: 300 });
  assert.equal(moving.results[0].outcome, "moved");
  assert.equal(moving.results[0].movementPx, 80);

  const boundary = harness();
  boundary.wheel(120, 700);
  boundary.finish(200, { scrollTop: 700, scrollHeight: 1000, clientHeight: 300 });
  assert.equal(boundary.results[0].outcome, "boundary");
  assert.equal(boundary.results[0].expectedMovement, false);
});

test("opposing wheel events retain burst evidence without a false stall", () => {
  const run = harness();
  run.wheel(120);
  run.wheel(-120);
  run.finish();
  assert.equal(run.results[0].outcome, "neutral");
  assert.equal(run.results[0].events, 2);
});
