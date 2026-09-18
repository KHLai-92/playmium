import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewSession } from "../src/preview-session.ts";

test("preview session dispatches activation synchronously and only presents the latest completion", async () => {
  const starts = [];
  const views = [];
  const browser = { activate(intent, context) { starts.push({ intent, context }); return new Promise(resolve => { context.complete = resolve; }); } };
  const session = createPreviewSession({ browser, present: view => views.push(view) });

  const first = session.dispatch({ type: "activate", videoId: "abcdefghijk", target: {} });
  assert.equal(first.handled, true);
  assert.equal(starts.length, 1, "browser activation must start before dispatch returns");
  session.dispatch({ type: "activate", videoId: "lmnopqrstuv", target: {} });
  assert.equal(starts[0].context.signal.aborted, true);

  starts[0].context.complete({ phase: "active", videoId: "abcdefghijk" });
  starts[1].context.complete({ phase: "active", videoId: "lmnopqrstuv" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(views.at(-1).videoId, "lmnopqrstuv");
  assert.equal(views.some(view => view.videoId === "abcdefghijk" && view.phase === "active"), false);
});

test("preview session close and disposal are idempotent and terminal for late work", async () => {
  let complete;
  let closes = 0;
  let disposals = 0;
  const views = [];
  const session = createPreviewSession({
    browser: {
      activate() { return new Promise(resolve => { complete = resolve; }); },
      close() { closes++; },
      dispose() { disposals++; },
    },
    present: view => views.push(view),
  });
  session.dispatch({ type: "activate", videoId: "abcdefghijk", target: {} });
  session.dispatch({ type: "close", reason: "outside" });
  session.dispatch({ type: "close", reason: "outside" });
  assert.equal(closes, 1);
  session.dispose(); session.dispose();
  assert.equal(disposals, 1);
  assert.equal(session.dispatch({ type: "control", action: "play" }).handled, false);
  complete({ phase: "active", videoId: "abcdefghijk" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(views.at(-1).phase, "disposed");
});

test("manual pause remains authoritative while activation finishes", async () => {
  let complete;
  const views = [];
  const session = createPreviewSession({
    browser: {
      activate() { return new Promise(resolve => { complete = resolve; }); },
      control() {},
    },
    present: view => views.push(view),
  });
  session.dispatch({ type: "activate", videoId: "abcdefghijk", target: {} });
  session.dispatch({ type: "control", action: "pause" });
  complete({ phase: "active", videoId: "abcdefghijk", wantsPlayback: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(views.at(-1).phase, "active");
  assert.equal(views.at(-1).wantsPlayback, false);
});

test("preview session turns toggle playback into explicit effects and owns playback intent", () => {
  const effects = [];
  const views = [];
  const session = createPreviewSession({
    browser: { control(intent) { effects.push(intent.action); return { wantsPlayback: intent.action === "pause" }; } },
    present: view => views.push(view),
  });

  assert.equal(session.dispatch({ type: "control", action: "toggle-play" }).view.wantsPlayback, false);
  assert.equal(session.dispatch({ type: "control", action: "toggle-play" }).view.wantsPlayback, true);
  assert.deepEqual(effects, ["pause", "play"]);
  assert.equal(views.at(-1).wantsPlayback, true, "browser completions cannot rewrite session-owned intent");
});

test("startup and fullscreen recovery are bounded, one-shot, and respect manual pause", () => {
  let now = 100;
  const effects = [];
  const session = createPreviewSession({
    browser: { control(intent) { effects.push(intent.action); } },
    present() {},
    now: () => now,
  });
  session.dispatch({ type: "activate", videoId: "abcdefghijk", target: {} });
  session.dispatch({ type: "lifecycle", event: "startup-ready" });
  assert.deepEqual(effects, ["play"], "startup completion resumes requested playback");
  session.dispatch({ type: "lifecycle", event: "media-pause", playable: true });
  session.dispatch({ type: "lifecycle", event: "media-pause", playable: true });
  assert.deepEqual(effects, ["play", "play"], "a delayed browser pause is recovered only once");

  session.dispatch({ type: "lifecycle", event: "arm-playback-recovery" });
  session.dispatch({ type: "control", action: "pause" });
  session.dispatch({ type: "lifecycle", event: "media-pause", playable: true });
  assert.equal(effects.at(-1), "pause", "manual pause cancels recovery");

  session.dispatch({ type: "control", action: "play" });
  session.dispatch({ type: "lifecycle", event: "arm-playback-recovery" });
  now += 1501;
  session.dispatch({ type: "lifecycle", event: "media-pause", playable: true });
  session.dispatch({ type: "lifecycle", event: "media-pause", playable: false });
  assert.deepEqual(effects.slice(-2), ["play", "play"], "expired or unplayable media cannot be revived");
});

test("playback toggle during masked startup changes intent instead of trusting the temporarily paused media", () => {
  const effects = [];
  const session = createPreviewSession({
    browser: {
      activate() { return { phase: "loading" }; },
      playbackPaused() { return true; },
      control(intent) { effects.push(intent.action); },
    },
    present() {},
  });
  session.dispatch({ type: "activate", videoId: "abcdefghijk", target: {} });
  const result = session.dispatch({ type: "control", action: "toggle-play" });
  assert.equal(result.view.wantsPlayback, false);
  assert.deepEqual(effects, ["pause"]);
});

test("control intents share one dispatch seam and stale control completions cannot overwrite newer intent", async () => {
  const starts = [];
  const views = [];
  const session = createPreviewSession({
    browser: {
      control(intent, context) {
        starts.push({ intent, context });
        return new Promise(resolve => { context.complete = resolve; });
      },
    },
    present: view => views.push(view),
  });

  session.dispatch({ type: "control", action: "set-volume", value: 0.2 });
  session.dispatch({ type: "control", action: "set-volume", value: 0.8 });
  assert.equal(starts[0].context.signal.aborted, true, "a newer control must cancel older browser work");
  assert.equal(starts[1].context.signal.aborted, false);
  assert.deepEqual(starts.map(start => start.intent), [
    { type: "control", action: "set-volume", value: 0.2 },
    { type: "control", action: "set-volume", value: 0.8 },
  ]);

  starts[1].context.complete({ message: "volume:0.8" });
  starts[0].context.complete({ message: "volume:0.2" });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(views.at(-1).message, "volume:0.8");
});

test("playlist coordination receives a session-owned signal that supersession aborts", () => {
  const contexts = [];
  const session = createPreviewSession({
    browser: { playlist(_intent, context) { contexts.push(context); } },
    present() {},
  });
  session.dispatch({ type: "playlist", action: "select", videoId: "abcdefghijk" });
  session.dispatch({ type: "playlist", action: "select", videoId: "lmnopqrstuv" });
  assert.equal(contexts[0].signal.aborted, true);
  assert.equal(contexts[1].signal.aborted, false);
});

test("the single control seam covers media, presentation, page, and playlist controls", () => {
  const actions = [
    "toggle-play", "play", "pause", "toggle-mute", "set-muted", "set-volume", "adjust-volume",
    "set-speed", "seek-by", "seek-to", "toggle-fullscreen", "exit-fullscreen", "toggle-captions",
    "select-caption-language", "select-caption-translation", "select-quality", "toggle-settings",
    "toggle-chapters", "toggle-info", "toggle-playlist", "toggle-playlist-autoplay",
  ];
  const seen = [];
  const session = createPreviewSession({ browser: { control(intent) { seen.push(intent.action); } }, present() {} });
  for (const action of actions) assert.equal(session.dispatch({ type: "control", action }).handled, true);
  assert.deepEqual(seen, ["pause", ...actions.slice(1)], "every user control must cross the same synchronous dispatch boundary");
});
