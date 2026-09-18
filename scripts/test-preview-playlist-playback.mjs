import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createPlaylistPlaybackRestorer } from "../src/preview-playlist-playback.ts";

test("a superseded playlist selection cannot restore state into the next video", () => {
  const media = Object.assign(new EventTarget(), { muted: false, volume: .8, playbackRate: 1.25 });
  const calls = [];
  const player = {
    isMuted: () => false,
    getVolume: () => 80,
    getPlaybackRate: () => 1.25,
    setVolume: value => calls.push(["volume", value]),
    unMute: () => calls.push(["unmute"]),
    setPlaybackRate: value => calls.push(["rate", value]),
    playVideo: () => calls.push(["play"]),
  };
  let current = true;
  const playback = createPlaylistPlaybackRestorer(player, media, {
    isCurrent: () => current,
    audioUnchanged: () => true,
  });
  playback.listen();

  current = false;
  media.muted = true;
  media.volume = .2;
  media.playbackRate = 1;
  media.dispatchEvent(new Event("loadedmetadata"));

  assert.deepEqual(calls, [], "the old selection must not call the player after supersession");
  assert.deepEqual({ muted: media.muted, volume: media.volume, rate: media.playbackRate },
    { muted: true, volume: .2, rate: 1 });
});

test("playlist playback restoration listens only when the player response is ready to commit", () => {
  const media = Object.assign(new EventTarget(), { muted: false, volume: .8, playbackRate: 1.25 });
  const calls = [];
  let playerMuted = false;
  let playerVolume = 80;
  let playerRate = 1.25;
  const player = {
    isMuted: () => playerMuted,
    getVolume: () => playerVolume,
    getPlaybackRate: () => playerRate,
    setVolume: value => calls.push(["volume", value]),
    mute: () => calls.push(["mute"]),
    unMute: () => calls.push(["unmute"]),
    setPlaybackRate: value => calls.push(["rate", value]),
    playVideo: () => calls.push(["play"]),
  };
  const playback = createPlaylistPlaybackRestorer(player, media, {
    isCurrent: () => true,
    audioUnchanged: () => true,
  });

  media.dispatchEvent(new Event("loadedmetadata"));
  assert.deepEqual(calls, [], "the current media must not consume restoration listeners while the broker is pending");

  playerMuted = true;
  playerVolume = 35;
  playerRate = 1.5;
  media.muted = true;
  media.volume = .35;
  media.playbackRate = 1.5;
  playback.listen();
  media.dispatchEvent(new Event("loadeddata"));
  assert.deepEqual(calls, [["volume", 35], ["mute"], ["rate", 1.5], ["play"]],
    "state changed while the broker was pending must become the restoration snapshot");
});

test("playlist commit takes its audio-generation baseline after broker preparation", async () => {
  const source = await readFile("src/preview-playback.experiment.ts", "utf8");
  const brokerReady = source.indexOf("const supplied = await abortable(pending");
  const audioBaseline = source.indexOf("const audioVersion =", brokerReady);
  const listening = source.indexOf("playback?.listen()", brokerReady);
  assert.ok(brokerReady >= 0 && audioBaseline > brokerReady && listening > audioBaseline,
    "audio changes during broker preparation must be part of the committed restoration baseline");
});
