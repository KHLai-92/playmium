import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/preview-preference-storage.ts"], bundle: true,
  write: false, format: "esm", platform: "browser" });
const { createPreviewPreferenceStorage } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

test("saved preferences migrate to the Playmium namespace without replacing newer values", async () => {
  const values = {
    "skipAds.inlinePreviewLegacy.enabled": false,
    "skipAds.inlinePreviewLegacy.uiLanguage": "zh-TW",
    "playmium.inlinePreview.enabled": true,
  };
  const writes = [];
  const storage = {
    async get(keys) {
      if (keys === null) return { ...values };
      const requested = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(requested.filter(key => Object.hasOwn(values, key)).map(key => [key, values[key]]));
    },
    async set(update) {
      writes.push({ ...update });
      Object.assign(values, update);
    },
  };
  const migrated = createPreviewPreferenceStorage(storage, [
    { key: "playmium.inlinePreview.enabled", legacySuffix: ".enabled" },
    { key: "playmium.inlinePreview.uiLanguage", legacySuffix: ".uiLanguage" },
  ]);

  await migrated.ready;

  assert.deepEqual(writes, [{ "playmium.inlinePreview.uiLanguage": "zh-TW" }]);
  assert.deepEqual(await migrated.get(["playmium.inlinePreview.enabled", "playmium.inlinePreview.uiLanguage"]), {
    "playmium.inlinePreview.enabled": true,
    "playmium.inlinePreview.uiLanguage": "zh-TW",
  });
});
