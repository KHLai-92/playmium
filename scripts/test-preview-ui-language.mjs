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
  assert.equal(english.youtubeNativePreviews, "YouTube native previews");
  assert.equal(english.playmiumAddedPreviews, "Playmium-added previews");
  assert.equal(english.urlSearchMethod, "Search method");
  assert.equal(english.urlSearchHelp, "Chooses how Playmium finds videos for added previews. Full video URL is recommended.");
  assert.equal(english.playlistPreviewsKeptReady, "Previews kept ready");
  assert.equal(english.downloadCurrentLog, "Download session log");
  assert.equal(english.normalPlaybackSpeed, "1×");
  assert.equal(english.retriesPerLoadingStep, "Max attempts/step");
  assert.equal(english.previewStartupAttemptsHelp, "Limits how many times Playmium tries to start a preview.");
  assert.equal(english.previewStartupTimeoutHelp, "Limits how long each attempt may take.");
  assert.equal(english.retriesPerLoadingStepHelp, "Applies this limit to each step below.");
  assert.equal(english.preparePreviewTimeoutHelp, "Finds the matching video.");
  assert.equal(english.startPlayerTimeoutHelp, "Starts the preview data request.");
  assert.equal(english.loadVideoTimeoutHelp, "Waits for YouTube’s response.");
  assert.equal(Object.hasOwn(english, "restoreAllDefaultsTitle"), false);
  assert.equal(chinese.closeControlPanel, "關閉控制面板");
  assert.equal(chinese.closeAdvancedSettings, "關閉進階設定");
  assert.equal(chinese.youtube, "YouTube");
  assert.equal(chinese.playmium, "Playmium");
  assert.equal(chinese.youtubeNativePreviews, "YouTube 原生預覽");
  assert.equal(chinese.playmiumAddedPreviews, "Playmium 延伸預覽");
  assert.equal(chinese.urlSearchMethod, "搜尋方式");
  assert.equal(chinese.urlSearchHelp, "選擇 Playmium 尋找補充預覽影片的方式。建議使用完整影片網址。");
  assert.equal(chinese.urlSearchFullUrl, "影片網址");
  assert.equal(chinese.previewStartupAttemptsHelp, "Playmium 最多會嘗試啟動預覽幾次。");
  assert.equal(chinese.previewStartupTimeout, "單次嘗試逾時");
  assert.equal(chinese.previewStartupTimeoutHelp, "每次嘗試的等候時限。");
  assert.equal(chinese.playlistPreviewsKeptReady, "待播保留上限");
  assert.equal(chinese.retriesPerLoadingStep, "每階段嘗試上限");
  assert.equal(chinese.retriesPerLoadingStepHelp, "此上限會套用到下方各步驟。");
  assert.equal(chinese.downloadCurrentLog, "下載本次診斷紀錄");
  assert.equal(chinese.speed, "播放速度");
  assert.equal(chinese.on, "開啟");
  assert.equal(chinese.off, "關閉");
  assert.equal(chinese.advancedSettingsIntro, "請謹慎調整。若預覽失敗，請延長逾時時間。");
  assert.equal(chinese.translationOff, "不翻譯");
  assert.equal(chinese.qualityHighest, "最高");
  assert.equal(chinese.previewError("YouTube could not update subtitles. Try again."), "YouTube 無法更新字幕，請再試一次。");
});
