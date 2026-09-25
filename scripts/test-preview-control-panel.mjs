import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile("dist-preview-prototype/manifest.json", "utf8"));
const controls = await readFile("dist-preview-prototype/preview.js", "utf8");
const background = await readFile("dist-preview-prototype/preview-debug-log-background.js", "utf8");
const source = await readFile("src/inline-preview.prototype.ts", "utf8");
const uiLanguageSource = await readFile("src/preview-ui-language.ts", "utf8");
const backgroundSource = await readFile("src/preview-debug-log.background.ts", "utf8");

test("control panel URL search switch loads before preparation and persists with restore-all defaults", () => {
  assert.ok(controls.includes("Playlist preview lookup"));
  assert.ok(controls.includes("Search with"));
  assert.ok(controls.includes("Full video URL"));
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

test("Playmium controls use persistent inputs and show multiplier plus actual timeout", () => {
  assert.ok(controls.includes("Autoplay next playlist video: Off"));
  assert.ok(controls.includes("Max attempts/step"));
  assert.ok(source.includes('node("select", { id: "playlist-retention-capacity"'));
  assert.equal(source.includes('id: "playlist-retention-capacity", type: "range"'), false);
  assert.ok(source.includes('id: "preview-startup-attempts", type: "range"'));
  assert.ok(source.includes('id: "playlist-stage-retry-limit", type: "range"'));
  assert.ok(source.includes('id: "playlist-stage-retry-limit", type: "range", min: "1", max: "4"'));
  assert.ok(source.includes("const playlistStageRetryLimitFromInput = () => Number(playlistStageRetryLimitInput.value) - 1"));
  assert.ok(source.includes('playlistTimeoutRow("starting", "Search timeout", "Search timeout", "Finds the matching video.")'));
  assert.ok(source.includes('playlistTimeoutRow("ready", "Request timeout", "Request timeout", "Starts the preview data request.")'));
  assert.ok(source.includes('playlistTimeoutRow("request", "Response timeout", "Response timeout", "Waits for YouTube’s response.")'));
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
  assert.ok(controls.includes("Reset all settings"));
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

test("troubleshooting disables current-log download while auto-save is on", () => {
  assert.ok(source.includes('"Auto-save diagnostic logs"'));
  assert.ok(source.includes('"Download session log"'));
  assert.ok(source.includes('id: "troubleshooting-description"'));
  assert.ok(source.includes('id: "download-current-log-help"'));
  assert.ok(uiLanguageSource.includes('troubleshootingDescription: ""'));
  assert.ok(uiLanguageSource.includes('autoSaveLogsOn: ""'));
  assert.ok(uiLanguageSource.includes('autoSaveLogsOff: ""'));
  assert.ok(uiLanguageSource.includes('downloadCurrentLogHelp: ""'));
  assert.equal(uiLanguageSource.includes("Nothing is uploaded automatically."), false);
  assert.ok(source.includes('id: "troubleshooting"'));
  assert.ok(source.includes('class: "troubleshooting-toggle"'));
  assert.ok(source.includes('id: "playmium-actions"'));
  assert.ok(source.includes('#troubleshooting #export{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:38px'));
  assert.ok(source.includes("diagnosticSession.setAutoSave(value)"));
  assert.ok(source.includes("downloadLogButton.disabled = value"));
  assert.ok(source.includes("const report = diagnosticSession.exportCurrent()"));
  assert.doesNotMatch(source, /element\("export"\)\.onclick[\s\S]{0,800}applyLogAutoSave/,
    "manual download must not change the auto-save switch");
});

test("reference control panel keeps equal tab dimensions and contained text-triggered help", () => {
  assert.ok(source.includes('id: "advanced-settings-open"'));
  assert.ok(source.includes('"aria-expanded": "false", "aria-controls": "advanced-settings"'));
  assert.ok(source.includes('id: "advanced-settings", role: "dialog"'));
  assert.ok(source.includes("setAdvancedSettingsOpen(false, true)"));
  assert.ok(source.includes("#advanced-settings .settings-group>.row>label{display:grid"));
  assert.ok(source.includes("@container(min-width:1160px){#advanced-settings{right:468px}}"));
  assert.ok(source.includes("width:min(680px,calc(100% - 24px))"));
  assert.ok(source.includes("#advanced-settings>.settings-group-first{border-top:0"));
  assert.ok(source.includes('settingsHelp("advanced-settings-help"'));
  assert.equal(source.includes('settingsHelp("preview-search-help"'), false);
  assert.ok(source.includes('id: "settings-tooltip", role: "tooltip", hidden: ""'));
  assert.ok(source.includes(".settings-text-help:hover,.settings-text-help:focus-visible,.settings-text-help[aria-expanded=true]"));
  assert.ok(source.includes('#settings-tooltip[data-lines="2"]{width:300px;white-space:pre-line}'));
  assert.ok(source.includes('"data-tooltip-lines": "2"'));
  assert.ok(source.includes('"Applies this limit to each step below."'));
  assert.equal(source.includes("restoreAllDefaultsTitle"), false);
  assert.equal(source.includes('id: "restore-defaults", type: "button", class: "settings-text-help"'), false);
  assert.equal(source.includes("videoIdSearchButton.title = copy.urlSearchHelp"), false);
  assert.equal(source.includes("urlSearchButton.title = copy.urlSearchHelp"), false);
  assert.ok(source.includes("#advanced-settings{z-index:7;right:12px;width:min(680px,calc(100% - 24px));max-width:none;min-width:0;padding:0 18px 16px;overflow-x:hidden}"));
  assert.ok(source.includes("#advanced-settings-close{display:grid;place-items:center;width:34px;height:34px;padding:0;background:transparent;border:0"));
  assert.ok(source.includes("#controls{width:440px;height:326px}"));
  assert.ok(source.includes("#controls:has(#playmium-panel:not([hidden]) #troubleshooting[open]){height:auto;min-height:326px}"));
  assert.ok(source.includes("#playmium-actions{display:grid"));
  assert.ok(source.includes(".panel-nav-button{width:100%;min-height:35px"));
  assert.ok(source.includes('class: "toggle-switch"'));
  assert.equal(source.includes("quick-help-toggle"), false);
  assert.equal(source.includes("panel-nav-chevron"), false);
  assert.equal(source.includes("#controls{width:360px"), false);
  assert.equal(uiLanguageSource.includes("quickHelpTitle"), false);
});

test("interface language selection is persistent and updates English and Traditional Chinese copy", () => {
  assert.ok(controls.includes("Interface language"));
  assert.ok(uiLanguageSource.includes('traditionalChinese: "繁體中文"'));
  assert.ok(source.includes("loadPreviewUiLanguage(chrome.storage.local, uiLanguageKey)"));
  assert.ok(source.includes("savePreviewUiLanguage(chrome.storage.local, uiLanguageKey, uiLanguage)"));
  assert.ok(source.includes("applyUiLanguage(uiLanguageSelect.value)"));
  assert.ok(uiLanguageSource.includes('closeControlPanel: "關閉控制面板"'));
  assert.ok(uiLanguageSource.includes('closeAdvancedSettings: "關閉進階設定"'));
  assert.ok(uiLanguageSource.includes('translationOff: "不翻譯"'));
  assert.ok(uiLanguageSource.includes('qualityAuto: "自動"'));
  assert.ok(source.includes("copy.previewError(qualityState.error)"));
  assert.ok(source.includes("copy.previewError(captionState.error)"));
});
