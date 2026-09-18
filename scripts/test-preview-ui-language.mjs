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
  assert.equal(previewUiCopy("en").timeoutDescription(.5, 2.5), "0.5 times the standard timeout; 2.5 seconds");
  assert.equal(previewUiCopy("zh-TW").timeoutDescription(.5, 2.5), "標準逾時的 0.5 倍；2.5 秒");
});
