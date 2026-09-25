import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const extensionPath = path.resolve("dist-preview-prototype");
const userDataDir = await mkdtemp(path.join(os.tmpdir(), "playmium-layout-"));
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: "chromium",
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
  viewport: { width: 1270, height: 720 },
});

try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.route("https://www.youtube.com/**", route => route.fulfill({
    contentType: "text/html",
    body: "<!doctype html><html><body style=\"margin:0;background:#111\"></body></html>",
  }));
  await page.goto("https://www.youtube.com/");
  await page.waitForTimeout(500);

  const host = page.locator("#skip-ads-preview-prototype");
  await host.evaluate(element => {
    element.style.cssText = [
      "position:fixed!important",
      "inset:0 auto auto 0!important",
      "width:1000px!important",
      "height:700px!important",
      "max-width:none!important",
      "overflow:hidden!important",
    ].join(";");
  });

  await page.keyboard.press("Alt+P");
  await page.locator("#playmium-tab").click();
  const playmiumControlsBox = await page.locator("#controls").boundingBox();
  const retentionBox = await page.locator("#playlist-retention-capacity-trigger").boundingBox();
  const languageBox = await page.locator("#ui-language-trigger").boundingBox();
  assert.ok(playmiumControlsBox && retentionBox && languageBox, "Playmium controls must be measurable");
  const playmiumOverflow = await page.locator("#controls").evaluate(element => element.scrollHeight - element.clientHeight);
  assert.ok(playmiumOverflow <= 1, "collapsed Playmium controls should fit the YouTube-sized panel without scrolling");
  assert.ok(Math.abs(retentionBox.width - languageBox.width) <= 2,
    "retention and language selects should share a column width");
  assert.equal(await page.locator(".toggle-switch").count(), 1,
    "preview mode should use the standard switch treatment");
  await page.locator("#advanced-settings-open").click();

  const hostBox = await host.boundingBox();
  const advancedSettings = page.locator("#advanced-settings");
  const advancedBox = await advancedSettings.boundingBox();
  assert.ok(hostBox && advancedBox, "control panel layout must be measurable");
  assert.ok(Math.abs(advancedBox.width - 680) <= 1,
    `advanced settings should match the 680px reference width, got ${advancedBox.width}`);
  assert.equal(await page.locator("#advanced-settings > .settings-group").first().evaluate(element =>
    getComputedStyle(element).borderTopWidth), "0px",
  "the first advanced-settings section must not add a second header divider");
  assert.equal(await page.locator("#advanced-settings-close").evaluate(element =>
    getComputedStyle(element).borderTopWidth), "0px",
  "advanced-settings close button should not have an outline box");
  const failures = [];
  if (advancedBox.x < hostBox.x) {
    failures.push(`advanced settings starts outside its host: ${advancedBox.x} < ${hostBox.x}`);
  }
  if (advancedBox.x + advancedBox.width > hostBox.x + hostBox.width) {
    failures.push("advanced settings ends outside its host");
  }
  await page.locator("#advanced-settings-close").click();
  const advancedTriggerBox = await page.locator("#advanced-settings-open").boundingBox();
  const troubleshootingBox = await page.locator("#troubleshooting summary").boundingBox();
  assert.ok(advancedTriggerBox && troubleshootingBox, "stacked actions must be measurable");
  if (troubleshootingBox.y < advancedTriggerBox.y + advancedTriggerBox.height) {
    failures.push("troubleshooting should follow advanced settings on its own row");
  }
  if (Math.abs(advancedTriggerBox.width - troubleshootingBox.width) > 2) {
    failures.push("advanced settings and troubleshooting should share a full-width treatment");
  }

  await page.locator("#troubleshooting summary").click();
  const troubleshootingPanelBox = await page.locator("#troubleshooting").boundingBox();
  const downloadBox = await page.locator("#export").boundingBox();
  assert.ok(troubleshootingPanelBox && downloadBox, "expanded troubleshooting must be measurable");
  if (downloadBox.width < troubleshootingPanelBox.width - 28) {
    failures.push("download current log should fill the troubleshooting card");
  }

  await page.locator("#youtube-tab").click();
  const youtubeControlsBox = await page.locator("#controls").boundingBox();
  assert.ok(youtubeControlsBox, "YouTube controls must be measurable");
  if (Math.abs(playmiumControlsBox.width - youtubeControlsBox.width) > 1 ||
      Math.abs(playmiumControlsBox.height - youtubeControlsBox.height) > 1) {
    failures.push("YouTube and Playmium tabs should keep the same panel dimensions");
  }

  assert.deepEqual(failures, []);
  if (process.env.PLAYMIUM_LAYOUT_SCREENSHOTS === "1") {
    await host.evaluate(element => { element.style.width = "1270px"; });
    await page.locator("#playmium-tab").click();
    if (await page.locator("#troubleshooting").getAttribute("open") !== null) {
      await page.locator("#troubleshooting summary").click();
    }
    await page.locator("#advanced-settings-open").click();
    await page.screenshot({ path: ".scratch-reference-advanced.png", fullPage: true });
    await page.locator("#advanced-settings-close").click();
    await page.locator("#troubleshooting summary").click();
    await page.screenshot({ path: ".scratch-reference-troubleshooting.png", fullPage: true });
  }
  console.log("Control panel matches the reference layout, stays inside a 1000px player, and keeps equal tab dimensions.");
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}
