import assert from "node:assert/strict";
import test from "node:test";
import { createPlaylistHoverIntent } from "../src/preview-playlist-hover.ts";
import { playlistPreviewRetentionTtlMs } from "../src/preview-playlist.ts";
import { bindPlaylistSource, collectionPlaylistId, createPlaylistLoadCoordinator, extractPlaylist,
  isPlaybackTroubleNotification, loadPlaylistPreviewRetentionCapacity,
  normalizePlaylistPreviewRetentionCapacity, playlistGeometry, playlistPlaybackAudioState, playlistSeedFromLinks,
  playlistDrawerRightInset, playlistPreviewRetentionCapacity, playlistWarmEvent, retainPlaylistPreviews,
  savePlaylistPreviewRetentionCapacity, validatedPlaylistPlayerResponse } from "../src/preview-playlist.ts";

test("playlist hover preparation defaults to one retained response", () => {
  assert.equal(retainPlaylistPreviews, true);
  assert.equal(playlistPreviewRetentionCapacity, 1);
});

test("playlist preparation dwell and completed-response retention remain separate policies", () => {
  const timers = new Map(); let prepared = 0;
  const hover = createPlaylistHoverIntent({ schedule(callback, delay) { timers.set(1, { callback, delay }); return 1; },
    cancel(timer) { timers.delete(timer); } });
  hover.enter("abcdefghijk", () => prepared++);
  assert.equal(timers.get(1).delay, 100);
  hover.leave("abcdefghijk"); assert.equal(timers.size, 0); assert.equal(prepared, 0);
  hover.enter("abcdefghijk", () => prepared++); timers.get(1).callback(); assert.equal(prepared, 1);
  assert.equal(playlistPreviewRetentionCapacity, 1); assert.equal(playlistPreviewRetentionTtlMs, 30_000);
  assert.equal(normalizePlaylistPreviewRetentionCapacity(3), 3);
});

test("playlist response retention is normalized to the adjustable one-to-three range", () => {
  assert.equal(normalizePlaylistPreviewRetentionCapacity(undefined), 1);
  assert.equal(normalizePlaylistPreviewRetentionCapacity("1"), 1);
  assert.equal(normalizePlaylistPreviewRetentionCapacity(2), 2);
  assert.equal(normalizePlaylistPreviewRetentionCapacity("3"), 3);
  assert.equal(normalizePlaylistPreviewRetentionCapacity(0), 1);
  assert.equal(normalizePlaylistPreviewRetentionCapacity(9), 3);
});

test("playlist response retention preference survives a page reload", async () => {
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
  const key = "skipAds.inlinePreviewPrototype.playlistPreviewRetentionCapacity";
  assert.equal(await loadPlaylistPreviewRetentionCapacity(storage, key), 1);
  await savePlaylistPreviewRetentionCapacity(storage, key, 3);
  assert.equal(await loadPlaylistPreviewRetentionCapacity(storage, key), 3);
  await savePlaylistPreviewRetentionCapacity(storage, key, 1);
  assert.equal(await loadPlaylistPreviewRetentionCapacity(storage, key), 1);
});

test("playlist switching preserves the exact mute and volume state", () => {
  for (const expected of [
    { playerMuted: true, playerVolume: 60, nativeMuted: true, nativeVolume: .6 },
    { playerMuted: false, playerVolume: 10, nativeMuted: false, nativeVolume: .1 },
    { playerMuted: false, playerVolume: 0, nativeMuted: false, nativeVolume: 0 },
  ]) {
    assert.deepEqual(playlistPlaybackAudioState(expected.playerMuted, expected.playerVolume, expected.nativeMuted, expected.nativeVolume), expected);
  }
});

test("playlist loading is primed while preview startup is still in progress", async () => {
  let calls = 0;
  let finish;
  const result = { playlistId: "RDabcdefghijk", source: "", videoId: "abcdefghijk", title: "Mix", currentIndex: 0,
    items: [{ videoId: "abcdefghijk", title: "One", channel: "", duration: "", thumbnail: "" },
      { videoId: "lmnopqrstuv", title: "Two", channel: "", duration: "", thumbnail: "" }], error: "" };
  const coordinator = createPlaylistLoadCoordinator(() => {
    calls++;
    return new Promise(resolve => { finish = () => resolve(result); });
  });

  const primed = coordinator.prime("abcdefghijk", "RDabcdefghijk");
  assert.equal(calls, 1, "priming must start the network work immediately");
  const requested = coordinator.load("abcdefghijk", "RDabcdefghijk");
  assert.equal(calls, 1, "the later UI request must reuse the in-flight preload");
  assert.equal(requested, primed);
  finish();
  assert.equal(await requested, result);
  assert.equal(playlistWarmEvent, "skip-ads-preview-playlist-warm");
});

test("an unparseable playlist becomes a bounded failure instead of an endless spinner", async () => {
  let calls = 0;
  const coordinator = createPlaylistLoadCoordinator(async () => { calls++; return null; });
  await assert.rejects(coordinator.load("abcdefghijk", "RDabcdefghijk"), /unavailable/i);
  await assert.rejects(coordinator.load("abcdefghijk", "RDabcdefghijk"), /unavailable/i);
  assert.equal(calls, 2, "a failed load must be evicted so Try again performs real work");
});

test("personalized RDMM merges the visible My Mix seeds when native data omits the active video", () => {
  const seed = { title: "My Mix", items: [
    { videoId: "w-2XqhJ5kMo", title: "ADÉLA - Ain't In LA", channel: "", duration: "3:08", thumbnail: "" },
    { videoId: "mcQqIwr-QWQ", title: "Kato Feat. Jon - Turn The Lights Off (LOVEIN Remix)", channel: "", duration: "7:07", thumbnail: "" },
  ] };
  const personalized = { contents: [
    { playlistPanelVideoRenderer: { videoId: "mcQqIwr-QWQ", title: { simpleText: "Kato Feat. Jon - Turn The Lights Off (LOVEIN Remix)" }, lengthText: { simpleText: "7:07" } } },
    { playlistPanelVideoRenderer: { videoId: "abcdefghijk", title: { simpleText: "Recovered recommendation" }, lengthText: { simpleText: "2:34" } } },
  ] };
  const result = extractPlaylist(personalized, "w-2XqhJ5kMo", "RDMM", "blob:current", seed);
  assert.equal(result?.title, "My Mix");
  assert.equal(result?.currentIndex, 0);
  assert.deepEqual(result?.items.map(item => item.videoId), ["w-2XqhJ5kMo", "mcQqIwr-QWQ", "abcdefghijk"]);
});

test("visible My Mix seeds rescue the playlist even when native data is unparseable", () => {
  const seed = { title: "My Mix", items: [
    { videoId: "w-2XqhJ5kMo", title: "ADÉLA - Ain't In LA", channel: "", duration: "3:08", thumbnail: "" },
    { videoId: "mcQqIwr-QWQ", title: "Kato Feat. Jon - Turn The Lights Off (LOVEIN Remix)", channel: "", duration: "7:07", thumbnail: "" },
  ] };
  const result = extractPlaylist({}, "w-2XqhJ5kMo", "RDMM", "blob:current", seed);
  assert.deepEqual(result?.items, seed.items);
  assert.equal(result?.title, "My Mix");
});

test("My Mix title and two visible tracks are recovered from the result card links", () => {
  const result = playlistSeedFromLinks("My Mix告五人, Lady Gaga, Magic System, and moreADÉLA", [
    { href: "/watch?v=w-2XqhJ5kMo&list=RDMM&start_radio=1", label: "合輯" },
    { href: "/watch?v=w-2XqhJ5kMo&list=RDMM&start_radio=1", label: "My Mix" },
    { href: "/watch?v=w-2XqhJ5kMo&list=RDMM&start_radio=1", label: "ADÉLA - Ain't In LA (Lyrics) | maybe tonight we don't gotta run away (432Hz) · 3:08" },
    { href: "/watch?v=mcQqIwr-QWQ&list=RDMM&start_radio=1", label: "Kato Feat. Jon - Turn The Lights Off (LOVEIN Remix) · 7:07" },
  ], "w-2XqhJ5kMo", "RDMM");
  assert.equal(result?.title, "My Mix");
  assert.deepEqual(result?.items.map(item => [item.videoId, item.duration]), [
    ["w-2XqhJ5kMo", "3:08"], ["mcQqIwr-QWQ", "7:07"],
  ]);
});

test("YouTube collection identity, rather than rendered badge text, enables a playlist", () => {
  assert.equal(collectionPlaylistId("/watch?v=BAkqJT_sMKQ&list=RDMM&start_radio=1", true), "RDMM");
  assert.equal(collectionPlaylistId("/watch?v=-J2rSm8K9_Y&list=PLDIoUOhQQPlXzhp-83rECoLaV6BwFtNC4", true), "PLDIoUOhQQPlXzhp-83rECoLaV6BwFtNC4");
  assert.equal(collectionPlaylistId("/watch?v=BAkqJT_sMKQ&list=RDMM&start_radio=1", false), null);
  assert.equal(collectionPlaylistId("/watch?v=BAkqJT_sMKQ", true), null);
});

test("playlist entrance is flush with the player while its drawer aligns with description", () => {
  const geometry = playlistGeometry({ playerLeft: 232, playerTop: 32, playerWidth: 1385, playerHeight: 780 });
  assert.equal(geometry.drawerRightInset, playlistDrawerRightInset);
  assert.equal(geometry.drawerLeft + geometry.drawerWidth, 1605);
  assert.equal(geometry.handleLeft + geometry.handleWidth, 1617);
  assert.ok(geometry.drawerLeft < geometry.handleLeft, "drawer grows leftward from the right-side entrance");
  assert.ok(geometry.drawerLeft >= 232, "drawer stays inside the player");
});

test("compact and fullscreen drawers keep the description right inset", () => {
  const compact = playlistGeometry({ playerLeft: 900, playerTop: 100, playerWidth: 320, playerHeight: 260 });
  const fullscreen = playlistGeometry({ playerLeft: 0, playerTop: 0, playerWidth: 1920, playerHeight: 1080 });
  assert.equal(compact.drawerLeft + compact.drawerWidth, 1208);
  assert.equal(fullscreen.drawerLeft + fullscreen.drawerWidth, 1908);
  assert.equal(compact.handleLeft + compact.handleWidth, 1220);
  assert.ok(compact.drawerWidth <= compact.playerWidth - playlistDrawerRightInset * 2);
});

test("native playlist panel data is normalized without inventing page items", () => {
  const panel = { playlistPanelRenderer: { title: { simpleText: "My Mix" }, contents: [
    { playlistPanelVideoRenderer: { videoId: "abcdefghijk", title: { simpleText: "One" }, shortBylineText: { runs: [{ text: "Artist A" }] }, lengthText: { simpleText: "3:01" }, thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg" }] } } },
    { playlistPanelVideoRenderer: { videoId: "lmnopqrstuv", title: { simpleText: "Two" }, shortBylineText: { simpleText: "Artist B" }, lengthText: { simpleText: "4:02" } } },
  ] } };
  const result = extractPlaylist(panel, "abcdefghijk", "RDabcdefghijk", "blob:current");
  assert.equal(result?.title, "My Mix");
  assert.equal(result?.items.length, 2);
  assert.equal(result?.items[0].channel, "Artist A");
  assert.equal(result?.source, "blob:current");
});

test("native loose playlist renderers are accepted only after collection identity was established", () => {
  const data = { contents: [
    { playlistPanelVideoRenderer: { videoId: "abcdefghijk", title: { simpleText: "One" } } },
    { playlistPanelVideoRenderer: { videoId: "lmnopqrstuv", title: { simpleText: "Two" } } },
  ] };
  const result = extractPlaylist(data, "abcdefghijk", "RDabcdefghijk", "blob:current");
  assert.equal(result?.title, "Playlist");
  assert.deepEqual(result?.items.map(item => item.videoId), ["abcdefghijk", "lmnopqrstuv"]);
});

test("a cached playlist is rebound to each preview session source", () => {
  const cached = { playlistId: "RDabcdefghijk", source: "blob:first", videoId: "abcdefghijk", title: "Mix", currentIndex: 0,
    items: [{ videoId: "abcdefghijk", title: "One", channel: "", duration: "", thumbnail: "" },
      { videoId: "lmnopqrstuv", title: "Two", channel: "", duration: "", thumbnail: "" }], error: "" };
  const current = bindPlaylistSource(cached, "blob:second");
  assert.equal(current.source, "blob:second");
  assert.equal(cached.source, "blob:first", "the source-independent cache entry must not be mutated");
});

test("inline playlist switching validates playback data without removing watch-page fields", () => {
  const response = {
    playabilityStatus: { status: "OK" },
    videoDetails: { videoId: "abcdefghijk", title: "Two" },
    streamingData: { adaptiveFormats: [{ itag: 137 }] },
    playerAds: [{ ad: true }], adPlacements: [{ ad: true }], adSlots: [{ ad: true }], adBreakHeartbeatParams: "ad",
  };
  const result = validatedPlaylistPlayerResponse(response, "abcdefghijk");
  assert.deepEqual(result?.streamingData, response.streamingData);
  assert.equal(result?.videoDetails.videoId, "abcdefghijk");
  assert.equal(result, response);
  for (const key of ["playerAds", "adPlacements", "adSlots", "adBreakHeartbeatParams"]) assert.equal(Object.hasOwn(result, key), true);
  assert.equal(validatedPlaylistPlayerResponse(response, "lmnopqrstuv"), null, "a mismatched response cannot switch the player");
});

test("only YouTube's ad-blocker playback-trouble notification is identified", () => {
  const notification = { actionButton: { buttonRenderer: { navigationEndpoint: { urlEndpoint: {
    url: "https://support.google.com/youtube/answer/3037019#check_ad_blockers&zippy=%2Ccheck-your-extensions-including-ad-blockers",
  } } } } };
  assert.equal(isPlaybackTroubleNotification(notification), true);
  assert.equal(isPlaybackTroubleNotification({ actionButton: { buttonRenderer: { navigationEndpoint: { urlEndpoint: {
    url: "https://support.google.com/youtube/answer/3037019#check-internet-speed",
  } } } } }), false);
  assert.equal(isPlaybackTroubleNotification({ actionButton: { buttonRenderer: { navigationEndpoint: { urlEndpoint: {
    url: "https://example.com/youtube/answer/3037019#check_ad_blockers",
  } } } } }), false);
});
