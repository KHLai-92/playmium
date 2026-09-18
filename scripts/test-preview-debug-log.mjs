import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  createPreviewDiagnosticsSession,
  createPreviewDebugLogBatcher,
  loadPreviewLogAutoSavePreference,
  previewDiagnosticsSchemaVersion,
  resolvePreviewLogAutoSaveEnabled,
  savePreviewLogAutoSavePreference,
} from "../src/preview-debug-log.ts";
import { appendPreviewDebugLog, previewDebugLogFileName } from "../src/preview-debug-log-store.ts";

const packageVersion = JSON.parse(await readFile("package.json", "utf8")).version;

const entry = index => ({
  schemaVersion: previewDiagnosticsSchemaVersion,
  sessionId: "test-session",
  sequence: index,
  at: `2026-09-15T00:00:00.${String(index).padStart(3, "0")}Z`,
  monotonicMs: index,
  event: "preview.ready",
  detail: { videoId: `video-${index}` },
});

test("log auto-save defaults off but preserves an explicit opt-in", () => {
  assert.equal(resolvePreviewLogAutoSaveEnabled(undefined), false);
  assert.equal(resolvePreviewLogAutoSaveEnabled(null), false);
  assert.equal(resolvePreviewLogAutoSaveEnabled(true), true);
  assert.equal(resolvePreviewLogAutoSaveEnabled(false), false);
});

test("log auto-save preference survives reloads in both states", async () => {
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
  const key = "debugLoggingEnabled";

  assert.equal(await loadPreviewLogAutoSavePreference(storage, key), false);
  await savePreviewLogAutoSavePreference(storage, key, false);
  assert.equal(await loadPreviewLogAutoSavePreference(storage, key), false);
  await savePreviewLogAutoSavePreference(storage, key, true);
  assert.equal(await loadPreviewLogAutoSavePreference(storage, key), true);
});

test("one diagnostics session feeds independent auto-save and manual download paths", () => {
  const sends = [];
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  const session = createPreviewDiagnosticsSession(packageVersion, {
    schedule(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    cancel(id) { timers.delete(id); },
    send(batch) { sends.push(batch); },
    now() {
      const value = now++;
      return { at: `2026-09-16T00:00:00.${String(value).padStart(3, "0")}Z`, monotonicMs: value };
    },
    createSessionId() { return "session-one"; },
  }, { batchSize: 2 });

  session.record("preview.hover", { videoId: "abcdefghijk" });
  session.record("preview.ready", { videoId: "abcdefghijk" });
  assert.equal(sends.length, 0, "manual capture must not imply auto-save");
  assert.equal(session.exportCurrent().session.autoSave, false);
  assert.deepEqual(session.exportCurrent().entries.map(value => value.sequence), [1, 2]);

  session.setAutoSave(true);
  assert.deepEqual(sends.flatMap(batch => batch.entries.map(value => value.sequence)), [1, 2],
    "enabling auto-save must persist the current-session backlog exactly once");
  session.record("preview.click", { videoId: "abcdefghijk" });
  assert.equal(session.exportCurrent().session.autoSave, true, "manual download must not change the switch");
  session.setAutoSave(false);
  session.record("preview.start-play", { videoId: "abcdefghijk" });
  session.setAutoSave(true);
  session.flush();
  assert.deepEqual(sends.flatMap(batch => batch.entries.map(value => value.sequence)), [1, 2, 3, 4],
    "re-enabling auto-save must not duplicate prior entries");
});

test("manual diagnostics export identifies one bounded session and reports dropped entries", () => {
  let now = 0;
  const session = createPreviewDiagnosticsSession(packageVersion, {
    schedule() { return 1; }, cancel() {}, send() {},
    now() { return { at: `2026-09-16T00:00:00.${now}Z`, monotonicMs: now++ }; },
    createSessionId() { return "bounded-session"; },
  }, { maximumEntries: 2 });
  session.record("one");
  session.record("two");
  session.record("three");
  const report = session.exportCurrent();
  assert.equal(report.kind, "inline-preview-diagnostics");
  assert.equal(report.schemaVersion, previewDiagnosticsSchemaVersion);
  assert.equal(report.session.id, "bounded-session");
  assert.equal(report.session.droppedEntries, 1);
  assert.equal(report.session.firstSequence, 2);
  assert.equal(report.session.lastSequence, 3);
  assert.deepEqual(report.entries.map(value => value.event), ["two", "three"]);
});

test("debug log transport batches entries by count and time", async () => {
  const sends = [];
  const timers = new Map();
  let nextTimer = 0;
  const batcher = createPreviewDebugLogBatcher(packageVersion, {
    schedule(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
    cancel(id) { timers.delete(id); },
    send(batch) { sends.push(batch); },
  }, { batchSize: 2, flushIntervalMs: 250 });

  batcher.accept(entry(1));
  assert.equal(batcher.pending(), 1);
  assert.equal(timers.size, 1);
  batcher.accept(entry(2));
  assert.equal(batcher.pending(), 0);
  assert.deepEqual(sends.map(batch => batch.entries.length), [2]);

  batcher.accept(entry(3));
  [...timers.values()][0]();
  assert.deepEqual(sends.map(batch => batch.entries.length), [2, 1]);
  assert.equal(sends[0].version, packageVersion);
});

test("debug log store appends JSONL in a dedicated version file", async () => {
  let contents = "";
  let directoryName = "";
  let fileName = "";
  const fileHandle = {
    async getFile() { return { size: new TextEncoder().encode(contents).byteLength }; },
    async createWritable(options) {
      assert.deepEqual(options, { keepExistingData: true });
      let position = 0;
      return {
        async seek(value) { position = value; },
        async write(value) {
          assert.equal(position, new TextEncoder().encode(contents).byteLength);
          contents += value;
        },
        async close() {},
      };
    },
  };
  const directory = {
    async getFileHandle(name, options) { fileName = name; assert.deepEqual(options, { create: true }); return fileHandle; },
  };
  const root = {
    async getDirectoryHandle(name, options) { directoryName = name; assert.deepEqual(options, { create: true }); return directory; },
  };

  await appendPreviewDebugLog(root, packageVersion, [entry(1), entry(2)]);
  await appendPreviewDebugLog(root, packageVersion, [entry(3)]);
  assert.equal(directoryName, "debug-logs");
  assert.equal(fileName, previewDebugLogFileName(packageVersion));
  assert.equal(contents.trim().split("\n").length, 3);
  assert.deepEqual(contents.trim().split("\n").map(line => JSON.parse(line).detail.videoId), ["video-1", "video-2", "video-3"]);
});

test("debug log store bounds each version file and keeps the newest complete entries", async () => {
  const maximumBytes = 5 * 1024 * 1024;
  const compactionBytes = 4 * 1024 * 1024;
  const oldLine = `${JSON.stringify({ old: "x".repeat(900) })}\n`;
  let contents = oldLine.repeat(Math.floor(maximumBytes / new TextEncoder().encode(oldLine).byteLength));
  const remainingBytes = maximumBytes - new TextEncoder().encode(contents).byteLength;
  if (remainingBytes >= 3) contents += `${JSON.stringify("x".repeat(remainingBytes - 3))}\n`;
  const fileHandle = {
    async getFile() {
      return {
        size: new TextEncoder().encode(contents).byteLength,
        async text() { return contents; },
      };
    },
    async createWritable(options = {}) {
      let position = 0;
      if (!options.keepExistingData) contents = "";
      return {
        async seek(value) { position = value; },
        async write(value) {
          contents = `${contents.slice(0, position)}${value}${contents.slice(position + value.length)}`;
          position += value.length;
        },
        async close() {},
      };
    },
  };
  const directory = { async getFileHandle() { return fileHandle; } };
  const root = { async getDirectoryHandle() { return directory; } };

  await appendPreviewDebugLog(root, packageVersion, [entry(99)]);
  assert.ok(new TextEncoder().encode(contents).byteLength <= compactionBytes,
    "overflow compaction must leave enough headroom to amortize future appends");
  assert.equal(JSON.parse(contents.trim().split("\n").at(-1)).detail.videoId, "video-99");
});

test("built manifest, runtime diagnostics and log filename share package version", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  const build = await readFile("scripts/build-preview-prototype.mjs", "utf8");
  const runtime = await readFile("src/inline-preview.prototype.ts", "utf8");
  assert.match(build, /readFile\("package\.json"/);
  assert.match(build, /define: \{ __INLINE_PREVIEW_VERSION__/);
  assert.match(runtime, /prototypeVersion = previewDebugLogVersion/);
  assert.equal(previewDebugLogFileName(packageJson.version), `inline-preview-v${packageJson.version}.jsonl`);
});

test("debug coverage includes preview phases, resource lifetimes, and summarized interaction state", async () => {
  const runtime = await readFile("src/inline-preview.prototype.ts", "utf8");
  const catalog = await readFile("src/preview-playlist-catalog.ts", "utf8");
  const playlistMain = `${await readFile("src/preview-playlist.main.ts", "utf8")}\n${await readFile("src/preview-playback.experiment.ts", "utf8")}`;
  const brokerTop = await readFile("src/preview-playlist-broker-top.main.ts", "utf8");
  const brokerFrame = await readFile("src/preview-playlist-broker-frame.main.ts", "utf8");
  for (const event of ["preview.hover", "preview.preparing", "preview.ready", "preview.click", "preview.start-play"]) {
    assert.match(runtime, new RegExp(event.replace(".", "\\.")), `${event} must be recorded`);
  }
  assert.match(runtime, /interaction\.summary/);
  assert.match(runtime, /area: debugScrollArea/);
  assert.match(runtime, /backdropPointerEvents/);
  assert.match(runtime, /playlistList\.addEventListener\("scroll"/);
  assert.match(runtime, /window\.addEventListener\("wheel"/);
  assert.match(runtime, /playlist\.scroll-stalled/);
  for (const event of ["resource.create", "resource.hit", "resource.expire", "resource.evict", "resource.release"]) {
    assert.match(`${runtime}\n${catalog}`, new RegExp(event.replace(".", "\\.")), `${event} must be recorded`);
  }
  for (const event of ["preview.prepare-intent", "preview.prepare-phase", "preview.prepare-cancel", "preview.select-phase"]) {
    assert.match(runtime, new RegExp(event.replace(".", "\\.")), `${event} must identify the UI boundary`);
  }
  for (const event of ["preview.select-request", "preview.select-await-broker", "preview.select-broker-response",
    "preview.select-response-valid", "preview.select-player-commit", "preview.select-first-frame", "preview.select-success", "preview.select-error"]) {
    assert.match(playlistMain, new RegExp(event.replace(".", "\\.")), `${event} must identify the playback handoff boundary`);
  }
  for (const event of ["preview.prepare-start", "preview.broker-online", "preview.broker-command", "preview.broker-progress",
    "preview.broker-response", "preview.broker-error", "preview.broker-message-ignored"]) {
    assert.match(brokerTop, new RegExp(event.replace(".", "\\.")), `${event} must identify the broker boundary`);
  }
  for (const source of [runtime, playlistMain, brokerTop]) assert.match(source, /actionId/,
    "every playlist action-chain layer must carry the same action identity");
  assert.match(brokerTop, /layer: "youtube-player-response"/);
  assert.match(brokerTop, /"youtube-renderer"/);
  assert.match(brokerFrame, /stage, error, elapsedMs/,
    "the frame must report stage and elapsed time so YouTube delay is distinguishable from extension overhead");
});
