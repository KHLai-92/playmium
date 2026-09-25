// Build the standalone unpacked extension and validate its generated manifest.
import { build } from "esbuild";
import { mkdir, writeFile, cp, rm, readFile } from "node:fs/promises";
import path from "node:path";

const outdir = path.resolve("dist-playmium");
const { version } = JSON.parse(await readFile("package.json", "utf8"));
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    preview: "src/inline-preview.ts",
    "preview-main": "src/preview-main.ts",
    "preview-debug-log-background": "src/preview-debug-log.background.ts",
  },
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome150",
  define: { __INLINE_PREVIEW_VERSION__: JSON.stringify(version) },
});
await cp("assets/inline-preview", path.join(outdir, "icons"), { recursive: true });
await writeFile(path.join(outdir, "manifest.json"), JSON.stringify({
  manifest_version: 3,
  name: "Playmium",
  version,
  permissions: ["storage", "unlimitedStorage", "activeTab"],
  background: { service_worker: "preview-debug-log-background.js" },
  icons: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`])),
  action: {
    default_title: "Open Inline Preview control panel",
    default_icon: Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`])),
  },
  web_accessible_resources: [{ resources: ["icons/*.png"], matches: ["https://www.youtube.com/*"] }],
  description: "Inline video previews for YouTube.",
  content_scripts: [{
    matches: ["https://www.youtube.com/*"],
    js: ["preview-main.js"],
    world: "MAIN",
    run_at: "document_start",
    all_frames: true,
  }, {
    matches: ["https://www.youtube.com/*"],
    js: ["preview.js"],
    run_at: "document_start",
  }],
}, null, 2) + "\n");
console.log(`Extension built: ${outdir}\nPreview mode defaults on. Native entries stay native; other videos use the shared preview interface. Alt+P opens controls. Shorts keep native behavior.`);
