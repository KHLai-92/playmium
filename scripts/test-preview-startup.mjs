import assert from "node:assert/strict";
import test from "node:test";
import { defaultPreviewStartupAttempts, defaultPreviewStartupTimeoutSeconds, normalizePreviewStartupAttempts,
  normalizePreviewStartupTimeoutSeconds, previewStartupWakeDelaysMs,
  resolvePreviewStartupWakeTarget } from "../src/preview-startup.ts";

test("startup timeout uses the measured three-second default and stays configurable", () => {
  assert.equal(defaultPreviewStartupTimeoutSeconds, 3);
  assert.equal(normalizePreviewStartupTimeoutSeconds(null), 3);
  assert.equal(normalizePreviewStartupTimeoutSeconds("2"), 2);
  assert.equal(normalizePreviewStartupTimeoutSeconds("3.14"), 3.1);
  assert.equal(normalizePreviewStartupTimeoutSeconds("9.6"), 5);
  assert.equal(normalizePreviewStartupTimeoutSeconds("99"), 5);
});

test("startup attempt count defaults to and is capped at three", () => {
  assert.equal(defaultPreviewStartupAttempts, 3);
  assert.equal(normalizePreviewStartupAttempts(null), 3);
  assert.equal(normalizePreviewStartupAttempts("1"), 1);
  assert.equal(normalizePreviewStartupAttempts("2"), 2);
  assert.equal(normalizePreviewStartupAttempts("9"), 3);
});

test("startup retry replaces a detached click target with the current thumbnail for the same video", () => {
  const videoId = "-J2rSm8K9_Y";
  const detachedClickTarget = { name: "detached click target", isConnected: false, videoId };
  const unrelatedThumbnail = { name: "other thumbnail", isConnected: true, videoId: "abcdefghijk" };
  const currentThumbnail = { name: "current thumbnail", isConnected: true, videoId };
  const resolved = resolvePreviewStartupWakeTarget(detachedClickTarget, videoId,
    [unrelatedThumbnail, currentThumbnail], candidate => candidate.videoId);
  assert.equal(resolved, currentThumbnail,
    "YouTube may replace a thumbnail during startup; retries must not keep dispatching hover to the detached node");
});

test("startup recovery refreshes a stale connected target and repeats only a bounded wake sequence", () => {
  const videoId = "-J2rSm8K9_Y";
  const staleThumbnail = { name: "stale thumbnail", isConnected: true, videoId };
  const currentThumbnail = { name: "current thumbnail", isConnected: true, videoId };
  assert.equal(resolvePreviewStartupWakeTarget(staleThumbnail, videoId, [currentThumbnail], candidate => candidate.videoId, true),
    currentThumbnail);
  assert.deepEqual(previewStartupWakeDelaysMs, [0, 100, 300, 700, 1_200]);
});
