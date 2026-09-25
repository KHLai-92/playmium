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
  assert.equal(await page.locator("#playmium-main > .preview-mode-card[title], #enable[aria-description]").count(), 0,
    "the main preview toggle must not expose a tooltip");
  assert.equal(await page.locator("#playmium-main > .row[title], #playlist-retention-capacity[aria-description], #playlist-retention-capacity-trigger[aria-description]").count(), 0,
    "the main retention control must not expose a tooltip");
  const playmiumOverflow = await page.locator("#controls").evaluate(element => element.scrollHeight - element.clientHeight);
  assert.ok(playmiumOverflow <= 1, "collapsed Playmium controls should fit the YouTube-sized panel without scrolling");
  assert.ok(Math.abs(retentionBox.width - languageBox.width) <= 2,
    "retention and language selects should share a column width");
  assert.ok(languageBox.y < retentionBox.y,
    "interface language should appear before previews kept ready");
  assert.equal(await page.locator(".toggle-switch").count(), 1,
    "preview mode should use the standard switch treatment");
  await page.locator("#troubleshooting summary").click();
  const downloadLog = page.locator("#export");
  assert.equal(await downloadLog.isDisabled(), false, "manual log download should start enabled");
  await page.locator("#auto-save-logs").click();
  assert.equal(await downloadLog.isDisabled(), true, "auto-save should disable manual log download");
  assert.equal(await downloadLog.evaluate(element => getComputedStyle(element).opacity), "0.45",
    "disabled download should use the shared disabled opacity");
  await page.locator("#auto-save-logs").click();
  assert.equal(await downloadLog.isDisabled(), false, "turning auto-save off should restore manual download");
  await page.locator("#troubleshooting summary").click();
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
  const startupAttemptsBox = await page.locator("#preview-startup-attempts").boundingBox();
  const startupTimeoutBox = await page.locator("#preview-startup-timeout").boundingBox();
  assert.ok(startupAttemptsBox && startupTimeoutBox && startupAttemptsBox.y < startupTimeoutBox.y,
    "maximum startup attempts should appear before attempt timeout");
  assert.deepEqual(await page.locator("#playlist-stage-retry-limit").evaluate(element => ({
    min: element.getAttribute("min"), max: element.getAttribute("max"), value: element.value,
  })), { min: "1", max: "4", value: "4" },
  "the retry setting should expose one through four attempts");
  const advancedSizeBeforeHelp = { width: advancedBox.width, height: advancedBox.height };
  assert.equal(await page.locator("#advanced-settings .settings-help").count(), 1,
    "only the Advanced settings header should retain a tooltip icon");
  assert.equal(await page.locator("#advanced-settings .settings-text-help").count(), 7,
    "every Advanced settings detail should expose its tooltip from text");
  assert.equal(await page.locator("#restore-defaults[data-tooltip], #restore-defaults[aria-description]").count(), 0,
    "Reset all settings must not expose a tooltip");
  assert.equal(await page.locator("#advanced-settings .settings-group h3[data-tooltip]").count(), 0,
    "section titles must not expose tooltips");
  await page.locator("#advanced-settings-help").hover();
  const advancedSizeWithHelp = await advancedSettings.boundingBox();
  assert.ok(advancedSizeWithHelp &&
    advancedSizeWithHelp.width === advancedSizeBeforeHelp.width &&
    advancedSizeWithHelp.height === advancedSizeBeforeHelp.height,
  "showing a tooltip must not enlarge advanced settings");
  assert.equal(await advancedSettings.evaluate(element => getComputedStyle(element).overflowX), "hidden",
    "advanced-settings tooltips must not escape the panel horizontally");
  await page.locator("#url-search-label").hover();
  const searchTooltip = page.locator("#settings-tooltip");
  const searchTooltipBox = await searchTooltip.boundingBox();
  assert.ok(searchTooltipBox, "Search with tooltip must be visible");
  assert.equal(await searchTooltip.getAttribute("data-lines"), "2",
    "Search with tooltip should use its two-line treatment");
  assert.match(await searchTooltip.textContent(), /\.\nFull video URL is recommended\.$/,
    "Search with tooltip should break between its two sentences");
  assert.ok(Math.abs(searchTooltipBox.width - 300) <= 1,
    `Search with tooltip should be only slightly wider, got ${searchTooltipBox.width}px`);
  assert.ok(searchTooltipBox.x >= advancedBox.x && searchTooltipBox.y >= advancedBox.y &&
    searchTooltipBox.x + searchTooltipBox.width <= advancedBox.x + advancedBox.width &&
    searchTooltipBox.y + searchTooltipBox.height <= advancedBox.y + advancedBox.height,
  "Search with tooltip must remain inside Advanced settings");
  await page.locator("#playlist-starting-timeout-label").hover();
  assert.equal(await searchTooltip.textContent(), "Finds the matching video.");
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

  await page.locator("#playmium-tab").click();
  if (await page.locator("#troubleshooting").getAttribute("open") !== null) {
    await page.locator("#troubleshooting summary").click();
  }
  await page.locator("#ui-language").evaluate(element => {
    const select = /** @type {HTMLSelectElement} */ (element);
    select.value = "zh-TW";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.locator("#advanced-settings-label").textContent(), "進階設定");
  assert.equal(await page.locator("#playlist-retention-label").textContent(), "保留待播預覽");
  assert.ok(await page.locator("#playmium-main").evaluate(element => element.scrollWidth - element.clientWidth) <= 1,
    "Traditional Chinese main-panel copy should not overflow horizontally");
  await page.locator("#advanced-settings-open").click();
  assert.equal(await page.locator("#url-search-label").textContent(), "搜尋方式");
  assert.equal(await page.locator("#url-search").textContent(), "完整網址");
  assert.ok(await page.locator("#advanced-settings").evaluate(element => element.scrollWidth - element.clientWidth) <= 1,
    "Traditional Chinese advanced-settings copy should not overflow horizontally");
  await page.locator("#advanced-settings-close").click();
  await page.locator("#youtube-tab").click();
  assert.equal(await page.locator("#subtitles-label").textContent(), "字幕");
  assert.equal(await page.locator("#auto-translate-label").textContent(), "自動翻譯");
  assert.equal(await page.locator("#speed-label").textContent(), "速度");
  assert.equal(await page.locator("#quality-label").textContent(), "畫質");
  assert.equal(await page.locator("#caption-translation option").first().textContent(), "不翻譯");
  assert.equal(await page.locator('#speed option[value="1"]').textContent(), "1×");
  assert.equal(await page.locator("#quality option").first().textContent(), "自動");
  assert.equal(await page.locator("#caption-status").textContent(), "");
  assert.equal(await page.locator("#quality-status").textContent(), "");
  await page.locator("#playmium-tab").click();

  assert.deepEqual(failures, []);
  if (process.env.PLAYMIUM_LAYOUT_SCREENSHOTS === "1") {
    await host.evaluate(element => { element.style.width = "1270px"; });
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
