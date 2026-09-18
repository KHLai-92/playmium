// Run offline regressions; live YouTube scripts require a separate browser session.
import { readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync("scripts")
  .filter(name => /^test-preview-.+\.mjs$/.test(name) && !/-live\.mjs$/.test(name) && name !== "test-preview-baseline.mjs")
  .sort().map(name => `scripts/${name}`)
  .filter(file => !process.argv.includes("--node-only") || !/\b(?:chromium|firefox|webkit)\b|@playwright\//.test(readFileSync(file, "utf8")));
if (!files.length) throw new Error("No preview regression tests found");
const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
