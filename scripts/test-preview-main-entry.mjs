import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile("dist-playmium/manifest.json", "utf8"));

test("manifest deploys one explicit MAIN-world entry containing every page feature", async () => {
  const mainScripts = manifest.content_scripts.filter(script => script.world === "MAIN");
  assert.deepEqual(mainScripts.map(script => script.js), [["preview-main.js"]]);

  const compiled = await readFile("dist-playmium/preview-main.js", "utf8");
  for (const observableEvent of [
    "skip-ads-preview-quality-request",
    "skip-ads-preview-caption-request",
    "skip-ads-preview-metadata-request",
    "skip-ads-preview-info-request",
    "skip-ads-preview-playlist-request",
  ]) assert.ok(compiled.includes(observableEvent), `MAIN entry is missing ${observableEvent}`);

  for (const obsoleteArtifact of ["preview-quality.js", "preview-captions.js"]) {
    await assert.rejects(access(`dist-playmium/${obsoleteArtifact}`), { code: "ENOENT" });
  }
});
