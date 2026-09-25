import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultPreviewUiLanguage,
  loadPreviewUiLanguage,
  normalizePreviewUiLanguage,
  previewUiCopy,
  savePreviewUiLanguage,
} from "../src/preview-ui-language.ts";

test("interface language defaults to English and persists Traditional Chinese", async () => {
  const values = {};
  const storage = {
    async get(key) { return { [key]: values[key] }; },
    async set(next) { Object.assign(values, next); },
  };
  const key = "skipAds.inlinePreviewPrototype.uiLanguage";
  assert.equal(defaultPreviewUiLanguage, "en");
  assert.equal(normalizePreviewUiLanguage("unsupported"), "en");
  assert.equal(await loadPreviewUiLanguage(storage, key), "en");
  await savePreviewUiLanguage(storage, key, "zh-TW");
  assert.equal(await loadPreviewUiLanguage(storage, key), "zh-TW");
});

test("timeout accessibility copy explains the independently positioned visual values", () => {
  assert.equal(previewUiCopy("en").timeoutDescription(.5, 2.5), "0.5× default; 2.5 seconds");
  assert.equal(previewUiCopy("zh-TW").timeoutDescription(.5, 2.5), "預設值的 0.5 倍；2.5 秒");
});

test("control panel copy is precise and fully localized", () => {
  const english = previewUiCopy("en");
  const chinese = previewUiCopy("zh-TW");
  assert.equal(english.urlSearch, "Playlist preview lookup");
  assert.equal(english.playlistPreviewsKeptReady, "Previews kept ready");
  assert.equal(english.downloadCurrentLog, "Download session log");
  assert.equal(english.normalPlaybackSpeed, "1×");
  assert.equal(english.retriesPerLoadingStep, "Max attempts/step");
  assert.equal(english.previewStartupAttemptsHelp, "Limits how many times Playmium tries to start a preview.");
  assert.equal(english.previewStartupTimeoutHelp, "Limits how long each startup attempt may take.");
  assert.equal(english.retriesPerLoadingStepHelp, "Applies this limit to each step below.");
  assert.equal(english.preparePreviewTimeoutHelp, "Finds the matching video.");
  assert.equal(english.startPlayerTimeoutHelp, "Starts the preview data request.");
  assert.equal(english.loadVideoTimeoutHelp, "Waits for YouTube’s response.");
  assert.equal(english.restoreAllDefaultsTitle, "Restores all Playmium settings to their defaults.");
  assert.equal(chinese.closeControlPanel, "關閉控制面板");
  assert.equal(chinese.closeAdvancedSettings, "關閉進階設定");
  assert.equal(chinese.translationOff, "不翻譯");
  assert.equal(chinese.qualityHighest, "最高");
  assert.equal(chinese.previewError("YouTube could not update subtitles. Try again."), "YouTube 無法更新字幕，請再試一次。");
});
