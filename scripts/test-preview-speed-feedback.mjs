import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreviewPlaybackRate } from "../src/preview-media-policy.ts";

test("playback speed policy accepts finite values and clamps to the supported range", () => {
  assert.equal(normalizePreviewPlaybackRate(1.5), 1.5);
  assert.equal(normalizePreviewPlaybackRate(5), 2);
  assert.equal(normalizePreviewPlaybackRate(-1), 0.25);
  assert.equal(normalizePreviewPlaybackRate(Number.NaN), null);
});
