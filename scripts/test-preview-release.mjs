import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const installerManifest = JSON.parse(await readFile("installer-manifest.json", "utf8"));
const extensionManifest = JSON.parse(await readFile("dist-playmium/manifest.json", "utf8"));

test("Quick Install metadata tracks the built extension version", () => {
  const version = packageJson.version;
  assert.equal(installerManifest.schemaVersion, 1);
  assert.equal(installerManifest.extensionVersion, version);
  assert.equal(extensionManifest.version, version);
  assert.equal(installerManifest.archiveUrl,
    `https://github.com/KHLai-92/playmium/releases/download/v${version}/playmium-${version}.zip`);
  assert.match(installerManifest.sha256, /^[a-f0-9]{64}$/);
});
