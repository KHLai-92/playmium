import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile("dist-playmium/manifest.json", "utf8"));
const controls = await readFile("dist-playmium/preview.js", "utf8");
const background = await readFile("dist-playmium/preview-debug-log-background.js", "utf8");
const source = await readFile("src/inline-preview.ts", "utf8");
const advancedSettingsSource = await readFile("src/preview-advanced-settings.ts", "utf8");
const uiLanguageSource = await readFile("src/preview-ui-language.ts", "utf8");
const backgroundSource = await readFile("src/preview-debug-log.background.ts", "utf8");

test("control panel URL search switch loads before preparation and persists with restore-all defaults", () => {
  assert.ok(controls.includes("YouTube native previews"));
  assert.ok(controls.includes("Playmium-added previews"));
  assert.ok(controls.includes("Search method"));
  assert.ok(controls.includes("Full video URL"));
  assert.ok(advancedSettingsSource.includes('id: "url-search", type: "button"'));
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

test("Playmium controls use persistent compact choices and direct timeout seconds", () => {
  assert.ok(controls.includes("Autoplay next playlist video"));
  assert.ok(controls.includes("Max attempts/step"));
  assert.ok(source.includes('node("select", { id: "playlist-retention-capacity"'));
  assert.equal(source.includes('id: "playlist-retention-capacity", type: "range"'), false);
  assert.ok(advancedSettingsSource.includes('choice("preview-startup-attempts", "Max attempts")'));
  assert.ok(advancedSettingsSource.includes('choice("playlist-stage-retry-limit", "Max attempts/step")'));
  assert.ok(source.includes("applyPlaylistStageRetryLimit(action.attempts - 1)"));
  assert.ok(advancedSettingsSource.includes('id: "preview-startup-timeout", type: "range"'));
  assert.ok(advancedSettingsSource.includes("previewStartupTimeoutSecondsRange.min"));
  assert.ok(advancedSettingsSource.includes('const id = `playlist-${stage}-timeout-seconds`'));
  assert.ok(advancedSettingsSource.includes("playlistBrokerTimeoutSecondsRanges[stage]"));
  assert.ok(advancedSettingsSource.includes("playlistBrokerTimeoutSecondsStep"));
  assert.ok(uiLanguageSource.includes("Finds the matching video."));
  assert.ok(uiLanguageSource.includes("Starts the preview data request."));
  assert.ok(uiLanguageSource.includes("Waits for YouTube’s response."));
  assert.ok(advancedSettingsSource.includes('class: "playlist-timeout-output"'));
  assert.equal(advancedSettingsSource.includes('class: "timeout-multiplier"'), false);
  assert.equal(advancedSettingsSource.includes('class: "timeout-seconds"'), false);
  assert.ok(source.includes("preferenceStorage.set({ [enabledKey]: enabled })"));
  assert.ok(source.includes("savePlaylistPreviewRetentionCapacity(preferenceStorage"));
  assert.ok(source.includes("savePlaylistStageRetryLimit(preferenceStorage"));
  assert.ok(source.includes("savePlaylistBrokerTimeoutMultipliers(preferenceStorage"));
  assert.ok(source.includes("savePlaylistAutoplayPreference(preferenceStorage"));
  assert.ok(source.includes("savePreviewLogAutoSavePreference(preferenceStorage"));
  assert.ok(source.includes("[previewStartupTimeoutKey]: previewStartupTimeoutSeconds"));
  assert.ok(source.includes("[previewStartupAttemptsKey]: previewStartupAttempts"));
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(controls.includes("playlist-edge-gap"), false);
  assert.equal(controls.includes("Edge gap"), false);
});

test("native startup timeout does not control Playmium-added player startup", async () => {
  const eventsSource = await readFile("src/preview-playback-events.ts", "utf8");
  const adapterSource = await readFile("src/preview-playback-adapter.ts", "utf8");
  const playbackSource = await readFile("src/preview-playback.ts", "utf8");
  assert.equal(eventsSource.includes("timeoutMs: number"), false);
  assert.equal(adapterSource.includes("r.timeoutMs"), false);
  assert.equal(source.includes("timeoutMs: Math.min(15000, Math.max(2000, previewStartupTimeoutSeconds * 1000))"), false);
  assert.ok(playbackSource.includes("const newPlayerStartupSafetyTimeoutMs = 5000"));
  assert.ok(playbackSource.includes("newPlayerStartupSafetyTimeoutMs)"));
  assert.equal(playbackSource.includes("request.timeoutMs"), false);
});

test("Playmium settings stay inside narrow out-of-player panels", () => {
  assert.ok(source.includes('width:464px;height:calc(100vh - 32px)'));
  assert.ok(source.includes("@container(max-width:463px)"));
  assert.ok(source.includes("overflow-x:hidden;overflow-y:auto"));
  assert.ok(advancedSettingsSource.includes("@container(max-width:620px)"));
  assert.ok(advancedSettingsSource.includes("#advanced-settings .setting-label{grid-column:1/-1}"));
  assert.equal(source.includes("#playmium-panel .settings-group>.row>label"), false);
  assert.equal(source.includes('id: "mode-hint"'), false);
  assert.equal(controls.includes("Click a video preview to watch. Alt+P shows controls."), false);
});

test("Playmium exposes a persistent restore-all-defaults action", () => {
  assert.ok(controls.includes("Reset all settings"));
  assert.ok(advancedSettingsSource.includes('restoreButton.onclick = () => options.onAction({ type: "restore-defaults" })'));
  assert.ok(source.includes("function restoreDefaults()"));
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
  assert.ok(advancedSettingsSource.includes('id: "advanced-settings-open"'));
  assert.ok(advancedSettingsSource.includes('"aria-expanded": "false", "aria-controls": "advanced-settings"'));
  assert.ok(advancedSettingsSource.includes('id: "advanced-settings", role: "dialog"'));
  assert.ok(source.includes("advancedSettings.close(true)"));
  assert.ok(advancedSettingsSource.includes("#advanced-settings .settings-group>.row>label{display:grid"));
  assert.ok(advancedSettingsSource.includes("@container(min-width:1040px){#advanced-settings{right:468px}}"));
  assert.ok(advancedSettingsSource.includes("width:min(560px,calc(100% - 24px))"));
  assert.ok(advancedSettingsSource.includes("#advanced-settings>.settings-group-first{border-top:0"));
  assert.ok(advancedSettingsSource.includes('id: "youtube-native-previews-heading"'));
  assert.ok(advancedSettingsSource.includes('id: "playmium-added-previews-heading"'));
  assert.equal(advancedSettingsSource.includes('id: "preview-search-heading"'), false);
  assert.ok(advancedSettingsSource.indexOf('id: "youtube-native-previews-heading"') < advancedSettingsSource.indexOf('id: "playmium-added-previews-heading"'));
  assert.ok(advancedSettingsSource.includes('id: "advanced-settings-help", class: "settings-help"'));
  assert.equal(advancedSettingsSource.includes('id: "preview-search-help"'), false);
  assert.ok(advancedSettingsSource.includes('id: "settings-tooltip", role: "tooltip", hidden: ""'));
  assert.ok(advancedSettingsSource.includes(".settings-text-help:hover,.settings-text-help:focus-visible,.settings-text-help[aria-expanded=true]"));
  assert.ok(advancedSettingsSource.includes("#settings-tooltip{position:absolute;z-index:20;width:200px;max-width:calc(100% - 32px)"));
  assert.ok(advancedSettingsSource.includes("const tooltipWidths:"));
  for (const width of [168, 300, 220, 146, 136, 170, 130, 138, 160, 200, 133, 110, 142, 150]) {
    assert.ok(advancedSettingsSource.includes(`: ${width},`), `manual tooltip width ${width}px should be present`);
  }
  assert.ok(advancedSettingsSource.includes("tooltipWidths[model.language][target.id]"));
  assert.ok(source.includes(":host{color-scheme:dark;outline:none}"));
  assert.equal(source.includes('tooltipText.replace(/([.!?。！？])'), false);
  assert.equal(advancedSettingsSource.includes('"data-tooltip-lines": "2"'), false);
  assert.ok(uiLanguageSource.includes('"Applies this limit to each step below."'));
  assert.equal(advancedSettingsSource.includes("restoreAllDefaultsTitle"), false);
  assert.equal(advancedSettingsSource.includes('id: "restore-defaults", type: "button", class: "settings-text-help"'), false);
  assert.equal(advancedSettingsSource.includes("videoIdSearch.title = copy.urlSearchHelp"), false);
  assert.equal(advancedSettingsSource.includes("urlSearch.title = copy.urlSearchHelp"), false);
  assert.ok(advancedSettingsSource.includes("#advanced-settings{z-index:7;right:12px;width:min(560px,calc(100% - 24px));max-width:none;min-width:0;padding:0 18px 16px;overflow-x:hidden}"));
  assert.ok(advancedSettingsSource.includes("#advanced-settings .search-mode-card{display:grid"));
  assert.ok(advancedSettingsSource.includes("background:transparent;border:0;border-radius:0"));
  assert.ok(advancedSettingsSource.includes(".search-mode-buttons button,#advanced-settings .settings-choice button{min-width:0;min-height:28px"));
  assert.ok(advancedSettingsSource.includes("#advanced-settings-close{display:grid;place-items:center;width:34px;height:34px;padding:0;background:transparent;border:0"));
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
  assert.ok(source.includes("loadPreviewUiLanguage(preferenceStorage, uiLanguageKey)"));
  assert.ok(source.includes("savePreviewUiLanguage(preferenceStorage, uiLanguageKey, uiLanguage)"));
  assert.ok(source.includes("applyUiLanguage(uiLanguageSelect.value)"));
  assert.ok(uiLanguageSource.includes('closeControlPanel: "關閉控制面板"'));
  assert.ok(uiLanguageSource.includes('closeAdvancedSettings: "關閉進階設定"'));
  assert.ok(uiLanguageSource.includes('translationOff: "不翻譯"'));
  assert.ok(uiLanguageSource.includes('qualityAuto: "自動"'));
  assert.ok(source.includes("copy.previewError(qualityState.error)"));
  assert.ok(source.includes("copy.previewError(captionState.error)"));
});
