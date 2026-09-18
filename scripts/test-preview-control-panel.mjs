import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile("dist-preview-prototype/manifest.json", "utf8"));
const controls = await readFile("dist-preview-prototype/preview.js", "utf8");
const background = await readFile("dist-preview-prototype/preview-debug-log-background.js", "utf8");
const source = await readFile("src/inline-preview.prototype.ts", "utf8");
const backgroundSource = await readFile("src/preview-debug-log.background.ts", "utf8");

test("control panel URL search switch loads before preparation and persists with restore-all defaults", () => {
  assert.ok(controls.includes("Preview search"));
  assert.ok(source.includes('id: "url-search", type: "button"'));
  assert.ok(source.includes("await searchPreference.ready"));
  assert.ok(source.includes("searchPreference.set(useUrl)"));
  assert.ok(source.includes("chrome.storage.onChanged.addListener(onSearchStorageChange)"));
  assert.ok(source.includes("[previewUrlSearchKey]: defaultPreviewUrlSearchEnabled"));
});

test("extension action opens Playmium while the in-player gear opens YouTube", () => {
  assert.equal(manifest.action.default_title, "Open Inline Preview control panel");
  assert.ok(manifest.permissions.includes("activeTab"));
  assert.ok(background.includes("open-inline-preview-control-panel"));
  assert.ok(backgroundSource.includes('tab: "playmium"'));
  assert.ok(controls.includes("YouTube"));
  assert.ok(controls.includes("Playmium"));
  assert.ok(source.indexOf('id: "youtube-tab"') < source.indexOf('id: "playmium-tab"'));
  assert.ok(source.includes('action: "toggle-settings", value: "youtube"'));
  assert.ok(source.includes('openControlPanel("playmium")'));
});

test("Playmium controls use persistent sliders and show multiplier plus actual timeout", () => {
  assert.ok(controls.includes("Autoplay next playlist video: Off"));
  assert.ok(controls.includes("Retries per loading step"));
  assert.ok(source.includes('id: "preview-startup-attempts", type: "range"'));
  assert.ok(source.includes('id: "playlist-stage-retry-limit", type: "range"'));
  assert.ok(source.includes('playlistTimeoutRow("starting", "Prepare preview", "Prepare playlist preview timeout")'));
  assert.ok(source.includes('playlistTimeoutRow("ready", "Start player", "Start playlist player timeout")'));
  assert.ok(source.includes('playlistTimeoutRow("request", "Load video", "Load playlist video timeout")'));
  assert.ok(source.includes('class: "timeout-multiplier"'));
  assert.ok(source.includes('class: "timeout-seconds"'));
  assert.ok(source.includes('class: "playlist-timeout-output"'));
  assert.ok(source.includes("output.playlist-timeout-output{display:grid"));
  assert.ok(source.includes(".settings-group>.row>label>output{display:grid"),
    "all numeric slider values must share the multiplier column");
  assert.equal(source.includes(".settings-group output{display:grid"), false,
    "timeout columns must not change the layout of unrelated setting values");
  assert.ok(source.includes("grid-template-columns:48px 68px"));
  assert.ok(source.includes(".timeout-seconds{color:#91a0b3}"));
  assert.ok(source.includes("seconds: `(${copy.seconds(seconds)})`"));
  assert.ok(source.includes("chrome.storage.local.set({ [enabledKey]: enabled })"));
  assert.ok(source.includes("savePlaylistPreviewRetentionCapacity(chrome.storage.local"));
  assert.ok(source.includes("savePlaylistStageRetryLimit(chrome.storage.local"));
  assert.ok(source.includes("savePlaylistBrokerTimeoutMultipliers(chrome.storage.local"));
  assert.ok(source.includes("savePlaylistAutoplayPreference(chrome.storage.local"));
  assert.ok(source.includes("savePreviewLogAutoSavePreference(chrome.storage.local"));
  assert.ok(source.includes("[previewStartupTimeoutKey]: previewStartupTimeoutSeconds"));
  assert.ok(source.includes("[previewStartupAttemptsKey]: previewStartupAttempts"));
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(controls.includes("playlist-edge-gap"), false);
  assert.equal(controls.includes("Edge gap"), false);
});

test("Playmium settings stay inside narrow out-of-player panels", () => {
  assert.ok(source.includes("overflow-x:hidden;overflow-y:auto"));
  assert.ok(source.includes("#playmium-panel .settings-group>.row>label"));
  assert.ok(source.includes("grid-template-columns:minmax(0,1fr) 140px"));
  assert.ok(source.includes("#playmium-panel .setting-label{grid-column:1/-1}"));
  assert.equal(source.includes('id: "mode-hint"'), false);
  assert.equal(controls.includes("Click a video preview to watch. Alt+P shows controls."), false);
});

test("Playmium exposes a persistent restore-all-defaults action", () => {
  assert.ok(controls.includes("Restore all defaults"));
  assert.ok(source.includes("restoreDefaultsButton.onclick"));
  assert.ok(source.includes("[enabledKey]: true"));
  assert.ok(source.includes("[playlistPreviewRetentionCapacityKey]: defaultPlaylistPreviewRetentionCapacity"));
  assert.ok(source.includes("[playlistStageRetryLimitKey]: defaultPlaylistStageRetryLimit"));
  assert.ok(source.includes("[playlistBrokerTimeoutMultipliersKey]: defaultPlaylistBrokerTimeoutMultipliers"));
  assert.ok(source.includes("[playlistAutoplayKey]: defaultPlaylistAutoplayEnabled"));
  assert.ok(source.includes("[logAutoSaveKey]: defaultPreviewLogAutoSaveEnabled"));
  assert.ok(source.includes("[previewStartupTimeoutKey]: defaultPreviewStartupTimeoutSeconds"));
  assert.ok(source.includes("[previewStartupAttemptsKey]: defaultPreviewStartupAttempts"));
  assert.ok(source.includes("[uiLanguageKey]: defaultPreviewUiLanguage"));
});

test("troubleshooting presents independent auto-save and current-log download controls", () => {
  assert.ok(source.includes('"Auto-save logs"'));
  assert.ok(source.includes('"Download current log"'));
  assert.ok(source.includes("diagnosticSession.setAutoSave(value)"));
  assert.ok(source.includes("const report = diagnosticSession.exportCurrent()"));
  assert.doesNotMatch(source, /element\("export"\)\.onclick[\s\S]{0,800}applyLogAutoSave/,
    "manual download must not change the auto-save switch");
});

test("interface language selection is persistent and updates English and Traditional Chinese copy", () => {
  assert.ok(controls.includes("Interface language"));
  assert.ok(controls.includes("Traditional Chinese"));
  assert.ok(source.includes("loadPreviewUiLanguage(chrome.storage.local, uiLanguageKey)"));
  assert.ok(source.includes("savePreviewUiLanguage(chrome.storage.local, uiLanguageKey, uiLanguage)"));
  assert.ok(source.includes("applyUiLanguage(uiLanguageSelect.value)"));
});
