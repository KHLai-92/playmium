import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function importBrowserModule(entryPoint) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, format: "esm", platform: "browser" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${Date.now()}`);
}

test("the short RDMM recommendation-mix ID reaches the watch-page loader", async () => {
  const originalFetch = globalThis.fetch;
  const originalDocument = globalThis.document;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const requests = [];
  try {
    globalThis.document = { documentElement: { getAttribute() { return null; } } };
    globalThis.setInterval = () => 1;
    globalThis.clearInterval = () => {};
    globalThis.fetch = async input => {
      requests.push(String(input));
      return new Response('var ytInitialData = {"contents":[]};', { status: 200 });
    };
    const { loadWatchPage } = await importBrowserModule("src/preview-watch-data.main.ts");
    await loadWatchPage("w-2XqhJ5kMo", "RDMM");
    assert.deepEqual(requests, ["/watch?v=w-2XqhJ5kMo&list=RDMM"],
      "rejecting RDMM before fetch leaves the recommendation mix limited to its two visible seed links");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  }
});
