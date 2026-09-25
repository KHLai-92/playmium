// Exercises the built MAIN-world bridge with a native-player boundary fixture.
// These tests prove routing/guard behavior, not YouTube's HD stream delivery.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const compiled = await readFile("dist-playmium/preview-main.js", "utf8");
function setup() {
  const listeners = new Map();
  class Video extends EventTarget {}
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const calls = [];
  const host = { matches: () => true, contains: target => target === player || target === host };
  const player = { parentElement: host, getAvailableQualityLevels: () => ["hd1080", "hd720", "medium", "auto"],
    getPlaybackQuality: () => "medium", setPlaybackQualityRange: (...args) => calls.push(args) };
  const video = Object.assign(new Video(), { currentSrc: "blob:original", isConnected: true,
    classList: { contains: () => true }, closest: () => host, parentElement: player,
    currentTime: 87, volume: 0.6, muted: false, playbackRate: 1.5, paused: false });
  const location = { pathname: "/results" };
  const window = {}; window.top = window;
  vm.runInNewContext(compiled, { window, location, HTMLVideoElement: Video, CustomEvent,
    document: { addEventListener: (name, listener) => listeners.set(name, listener) } });
  let response;
  video.addEventListener("skip-ads-preview-quality-response", e => { response = JSON.parse(e.detail); });
  const raw = detail => {
    response = undefined;
    listeners.get("skip-ads-preview-quality-request")({ target: video, detail });
    return response;
  };
  return { video, player, location, calls, raw, request: quality => raw(JSON.stringify({ source: video.currentSrc, quality })) };
}

test("discovers live levels without requesting a stream", () => {
  const s = setup(); const state = s.request();
  assert.deepEqual(state.available, ["hd1080", "hd720", "medium"]);
  assert.equal(state.current, "medium"); assert.equal(state.supported, true);
  assert.equal(state.requested, null); assert.equal(s.calls.length, 0);
});
test("1080p, 720p and Auto route to the implemented range API; media state is preserved", () => {
  const s = setup();
  for (const paused of [false, true]) {
    s.video.paused = paused;
    for (const quality of ["hd1080", "hd720", "auto"]) {
      const before = [s.video.currentSrc, s.video.currentTime, s.video.volume, s.video.muted, s.video.playbackRate, s.video.paused];
      const state = s.request(quality);
      assert.deepEqual(s.calls.at(-1), [quality, quality]);
      assert.equal(state.requested, quality);
      assert.equal(state.current, "medium", "A request must not be reported as actual HD playback");
      assert.deepEqual([s.video.currentSrc, s.video.currentTime, s.video.volume, s.video.muted, s.video.playbackRate, s.video.paused], before);
    }
  }
});
test("removed quality is rejected on selection and refreshed", () => {
  const s = setup(); s.request(); s.player.getAvailableQualityLevels = () => ["medium"];
  const state = s.request("hd1080");
  assert.match(state.error, /no longer available/); assert.equal(s.calls.length, 0);
  assert.deepEqual(state.available, ["medium"]);
});
test("exceptions do not escape into existing playback controls; a retry works", () => {
  const s = setup(); s.player.setPlaybackQualityRange = () => { throw Error("unavailable"); };
  assert.match(s.request("hd720").error, /could not change/);
  s.player.setPlaybackQualityRange = () => {};
  assert.equal(s.request("hd720").error, "");
});
test("unsupported or empty capabilities fail closed without using the no-op API", () => {
  const s = setup(); delete s.player.setPlaybackQualityRange;
  s.player.setPlaybackQuality = () => assert.fail("Deprecated no-op API must not be used");
  assert.equal(s.request().supported, false);
  s.player.getAvailableQualityLevels = () => [];
  assert.equal(s.request().supported, false);
});
test("Shorts navigation, released video, and detached video ignore all requests", () => {
  for (const change of [s => { s.location.pathname = "/shorts/123"; },
    s => { s.video.classList.contains = () => false; }, s => { s.video.isConnected = false; },
    s => { s.video.closest = () => null; }]) {
    const s = setup(); change(s);
    assert.equal(s.request("hd720"), undefined); assert.equal(s.calls.length, 0);
  }
});

test("an authorized pinned preview on the watch page retains quality controls", () => {
  const s = setup(); s.location.pathname = "/watch";
  assert.equal(s.request("hd720").supported, true);
});
test("malformed messages, stale sources, and unknown qualities cannot select a stream", () => {
  const s = setup();
  for (const raw of ["bad json", "null", "x".repeat(2049), JSON.stringify({ source: "stale", quality: "hd720" }),
    JSON.stringify({ source: s.video.currentSrc, quality: "toString" }), JSON.stringify({ source: s.video.currentSrc, quality: [] })]) {
    assert.equal(s.raw(raw), undefined);
  }
  assert.equal(s.calls.length, 0);
});
test("replaced media source cannot inherit an old requested quality", () => {
  const s = setup(); s.request("hd1080"); s.video.currentSrc = "blob:replacement";
  assert.equal(s.request().requested, null); assert.equal(s.calls.length, 1);
});
