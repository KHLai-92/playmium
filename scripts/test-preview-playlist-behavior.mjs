import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPlaylistBrokerTimeoutMultipliers,
  defaultPlaylistStageRetryLimit,
  loadPlaylistBrokerTimeoutMultipliers,
  loadPlaylistAutoplayPreference,
  loadPlaylistStageRetryLimit,
  maximumPlaylistBrokerTimeoutMultiplier,
  minimumPlaylistBrokerTimeoutMultiplier,
  nextPlaylistAutoplayVideoId,
  normalizePlaylistBrokerTimeoutSettings,
  normalizePlaylistBrokerTimeoutMultiplier,
  normalizePlaylistBrokerTimeoutSeconds,
  normalizePlaylistStageRetryLimit,
  playlistBrokerStageTimeoutMs,
  playlistBrokerTimeoutBaselinesMs,
  playlistBrokerTimeoutMultiplierForSeconds,
  playlistBrokerTimeoutSeconds,
  playlistBrokerTimeoutSecondsRanges,
  playlistBrokerTimeoutSecondsStep,
  playlistDrawerRightInset,
  playlistGeometry,
  savePlaylistBrokerTimeoutMultipliers,
  savePlaylistAutoplayPreference,
  savePlaylistStageRetryLimit,
  validatedPlaylistPlayerResponse,
} from "../src/preview-playlist.ts";

test("playlist entrance is flush while the drawer matches the description right edge", () => {
  const geometry = playlistGeometry({ playerLeft: 232, playerTop: 32, playerWidth: 1385, playerHeight: 780 });
  const playerRight = 232 + 1385;
  assert.equal(geometry.handleLeft + geometry.handleWidth, playerRight);
  assert.equal(geometry.drawerLeft + geometry.drawerWidth, playerRight - playlistDrawerRightInset);
  assert.equal(playlistDrawerRightInset, 12);
});

test("playlist retry limit is bounded and persists across reloads", async () => {
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
  const key = "skipAds.inlinePreviewPrototype.playlistStageRetryLimit";
  assert.equal(defaultPlaylistStageRetryLimit, 2);
  assert.equal(await loadPlaylistStageRetryLimit(storage, key), defaultPlaylistStageRetryLimit);
  assert.equal(normalizePlaylistStageRetryLimit(-1), 0);
  assert.equal(normalizePlaylistStageRetryLimit("2"), 2);
  assert.equal(normalizePlaylistStageRetryLimit(99), 2);
  await savePlaylistStageRetryLimit(storage, key, 2);
  assert.equal(await loadPlaylistStageRetryLimit(storage, key), 2);
});

test("broker timeouts use compact stage-specific seconds ranges while preserving stored multipliers", async () => {
  assert.deepEqual(playlistBrokerTimeoutBaselinesMs, { starting: 5_000, ready: 1_500, request: 4_000 });
  assert.deepEqual(playlistBrokerTimeoutSecondsRanges, {
    starting: { min: 3, max: 8 },
    ready: { min: .8, max: 2.5 },
    request: { min: 2, max: 6 },
  });
  assert.equal(playlistBrokerTimeoutSecondsStep, .1);
  assert.equal(minimumPlaylistBrokerTimeoutMultiplier, .5);
  assert.equal(maximumPlaylistBrokerTimeoutMultiplier, 3);
  assert.equal(normalizePlaylistBrokerTimeoutMultiplier(.1), .5);
  assert.equal(normalizePlaylistBrokerTimeoutMultiplier(.63), .63);
  assert.equal(normalizePlaylistBrokerTimeoutMultiplier(9), 3);
  assert.equal(normalizePlaylistBrokerTimeoutSeconds("starting", .1), 3);
  assert.equal(normalizePlaylistBrokerTimeoutSeconds("starting", 9), 8);
  assert.equal(normalizePlaylistBrokerTimeoutSeconds("ready", .63), .8);
  assert.equal(normalizePlaylistBrokerTimeoutSeconds("request", 4.06), 4.1);
  assert.equal(playlistBrokerTimeoutMultiplierForSeconds("ready", 2.5), 1.6667);
  assert.equal(playlistBrokerTimeoutSeconds("request", { starting: 1, ready: 1, request: 1.25 }), 5);
  assert.deepEqual(normalizePlaylistBrokerTimeoutSettings({ starting: 3, ready: 3, request: 3 }), {
    starting: 1.6,
    ready: 1.6667,
    request: 1.5,
  });

  const shortest = { starting: .5, ready: .5, request: .5 };
  assert.deepEqual({
    starting: playlistBrokerStageTimeoutMs("starting", shortest),
    ready: playlistBrokerStageTimeoutMs("ready", shortest),
    request: playlistBrokerStageTimeoutMs("request", shortest),
  }, { starting: 2_500, ready: 750, request: 2_000 });
  const longestSettings = normalizePlaylistBrokerTimeoutSettings({ starting: 3, ready: 3, request: 3 });
  assert.deepEqual({
    starting: playlistBrokerStageTimeoutMs("starting", longestSettings),
    ready: playlistBrokerStageTimeoutMs("ready", longestSettings),
    request: playlistBrokerStageTimeoutMs("request", longestSettings),
  }, { starting: 8_000, ready: 2_500, request: 6_000 });

  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
  const key = "skipAds.inlinePreviewPrototype.playlistBrokerTimeoutMultipliers";
  assert.deepEqual(await loadPlaylistBrokerTimeoutMultipliers(storage, key), defaultPlaylistBrokerTimeoutMultipliers);
  const chosen = { starting: .75, ready: 1.5, request: 2.25 };
  await savePlaylistBrokerTimeoutMultipliers(storage, key, chosen);
  assert.deepEqual(await loadPlaylistBrokerTimeoutMultipliers(storage, key), chosen);
});

test("playlist autoplay preference persists and advances without wrapping", async () => {
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
  const key = "skipAds.inlinePreviewPrototype.playlistAutoplay";
  assert.equal(await loadPlaylistAutoplayPreference(storage, key), false);
  await savePlaylistAutoplayPreference(storage, key, true);
  assert.equal(await loadPlaylistAutoplayPreference(storage, key), true);

  const items = [{ videoId: "abcdefghijk" }, { videoId: "lmnopqrstuv" }];
  assert.equal(nextPlaylistAutoplayVideoId({ currentIndex: 0, items }), "lmnopqrstuv");
  assert.equal(nextPlaylistAutoplayVideoId({ currentIndex: 1, items }), null);
});

test("playlist player responses preserve every field supplied by YouTube", () => {
  const response = {
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId: "abcdefghijk" },
    streamingData: { formats: [] },
    playerAds: [{ ad: true }],
    adPlacements: [{ ad: true }],
    adSlots: [{ ad: true }],
    adBreakHeartbeatParams: "ad",
  };
  assert.equal(validatedPlaylistPlayerResponse(response, "abcdefghijk"), response);
  for (const key of ["playerAds", "adPlacements", "adSlots", "adBreakHeartbeatParams"])
    assert.equal(Object.hasOwn(response, key), true);
});
