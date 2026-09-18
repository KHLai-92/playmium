import assert from "node:assert/strict";
import test from "node:test";
import { createPlaylistCatalog } from "../src/preview-playlist-catalog.ts";
import { fetchWatchPageSource } from "../src/preview-watch-page-request.ts";

test("playlist catalog reuses work, bounds successful values, sweeps expiry, and retries failure", async () => {
  let now = 0;
  let sweep;
  let disposed = false;
  const calls = new Map();
  const catalog = createPlaylistCatalog(async request => {
    calls.set(request.videoId, (calls.get(request.videoId) ?? 0) + 1);
    if (request.videoId === "failure0000") throw new Error("network");
    return { ...request, loaded: calls.get(request.videoId) };
  }, {
    capacity: 2,
    successTtlMs: 100,
    sweepIntervalMs: 50,
    now: () => now,
    setInterval: callback => { sweep = callback; return 7; },
    clearInterval: id => { assert.equal(id, 7); disposed = true; },
  });

  const firstRequest = { videoId: "abcdefghijk", playlistId: "RDabcdefghijk" };
  assert.equal(catalog.load(firstRequest), catalog.load(firstRequest));
  assert.equal((await catalog.load(firstRequest)).loaded, 1);
  await catalog.load({ videoId: "lmnopqrstuv", playlistId: "RDlmnopqrstuv" });
  await catalog.load({ videoId: "wxyzABCDEFG", playlistId: "RDwxyzABCDEFG" });
  assert.equal((await catalog.load(firstRequest)).loaded, 2, "oldest value must be evicted at capacity");

  now = 101;
  sweep();
  assert.equal((await catalog.load(firstRequest)).loaded, 3, "expired value must be swept without revisiting its key");
  await assert.rejects(catalog.load({ videoId: "failure0000", playlistId: "RDfailure0000" }), /network/);
  await assert.rejects(catalog.load({ videoId: "failure0000", playlistId: "RDfailure0000" }), /network/);
  assert.equal(calls.get("failure0000"), 2);

  catalog.dispose();
  catalog.dispose();
  assert.equal(disposed, true);
});

test("playlist catalog aborts unowned pending work after its final subscriber cancels", async () => {
  let underlyingSignal;
  let finish;
  const catalog = createPlaylistCatalog((_request, options) => {
    underlyingSignal = options.signal;
    return new Promise(resolve => { finish = resolve; });
  });
  const first = new AbortController();
  const second = new AbortController();
  const request = { videoId: "abcdefghijk", playlistId: "RDabcdefghijk" };
  const one = catalog.load(request, { signal: first.signal });
  const two = catalog.load(request, { signal: second.signal });

  first.abort();
  await assert.rejects(one, { name: "AbortError" });
  assert.equal(underlyingSignal.aborted, false, "shared work still has one interested subscriber");
  second.abort();
  await assert.rejects(two, { name: "AbortError" });
  assert.equal(underlyingSignal.aborted, true, "unowned pending work must release its external operation");

  finish({ loaded: true });
  catalog.dispose();
});

test("watch-page requests forward catalog cancellation to fetch", async () => {
  let fetchSignal;
  const controller = new AbortController();
  const cancelled = fetchWatchPageSource((_url, options) => {
    fetchSignal = options.signal;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    });
  }, "/watch?v=abcdefghijk", controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  assert.equal(fetchSignal.aborted, true, "the production fetch signal must be aborted when the catalog work becomes unowned");
});
