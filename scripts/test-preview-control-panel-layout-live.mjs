import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const extensionPath = path.resolve("dist-playmium");
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

  const host = page.locator("#playmium-preview");
  await page.keyboard.press("Alt+P");
  const outOfPlayerControlsBox = await page.locator("#controls").boundingBox();
  assert.ok(outOfPlayerControlsBox, "out-of-player controls must be measurable");
  assert.ok(Math.abs(outOfPlayerControlsBox.width - 440) <= 1 && Math.abs(outOfPlayerControlsBox.height - 326) <= 1,
    `out-of-player controls should use the in-player 440 by 326 size, got ${outOfPlayerControlsBox.width} by ${outOfPlayerControlsBox.height}`);
  await page.keyboard.press("Alt+P");
  assert.equal(await host.evaluate(element => element.matches(":focus")), true,
    "closing standalone controls should move focus out of the hidden panel content");
  assert.equal(await host.evaluate(element => getComputedStyle(element).outlineStyle), "none",
  "the non-interactive focused host must not draw a page-sized outline");
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
  assert.ok(Math.abs(playmiumControlsBox.width - outOfPlayerControlsBox.width) <= 1 &&
    Math.abs(playmiumControlsBox.height - outOfPlayerControlsBox.height) <= 1,
  "out-of-player and in-player controls should have identical dimensions");
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
  assert.ok(Math.abs(advancedBox.width - 560) <= 1,
    `advanced settings should use the compact 560px width, got ${advancedBox.width}`);
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
  assert.deepEqual(await page.locator("#preview-startup-attempts button").evaluateAll(buttons => buttons.map(button => ({
    value: button.getAttribute("data-value"), pressed: button.getAttribute("aria-pressed"),
  }))), [
    { value: "1", pressed: "false" },
    { value: "2", pressed: "false" },
    { value: "3", pressed: "true" },
  ], "native preview attempts should use three exclusive buttons");
  assert.deepEqual(await page.locator("#playlist-stage-retry-limit button").evaluateAll(buttons => buttons.map(button => ({
    value: button.getAttribute("data-value"), pressed: button.getAttribute("aria-pressed"),
  }))), [
    { value: "1", pressed: "false" },
    { value: "2", pressed: "false" },
    { value: "3", pressed: "true" },
  ], "added-preview attempts should expose one through three attempts");
  await page.locator('#playlist-stage-retry-limit button[data-value="2"]').click();
  assert.equal(await page.locator('#playlist-stage-retry-limit button[data-value="2"]').getAttribute("aria-pressed"), "true",
    "attempt buttons should update immediately");
  assert.deepEqual(await page.locator("#preview-startup-timeout").evaluate(element => ({
    min: element.getAttribute("min"), max: element.getAttribute("max"), step: element.getAttribute("step"), value: element.value,
  })), { min: "2", max: "5", step: "0.1", value: "3" });
  for (const [stage, expected] of Object.entries({
    starting: { min: "3", max: "8", step: "0.1", value: "5" },
    ready: { min: "0.8", max: "2.5", step: "0.1", value: "1.5" },
    request: { min: "2", max: "6", step: "0.1", value: "4" },
  })) {
    assert.deepEqual(await page.locator(`#playlist-${stage}-timeout-seconds`).evaluate(element => ({
      min: element.getAttribute("min"), max: element.getAttribute("max"), step: element.getAttribute("step"), value: element.value,
    })), expected, `${stage} timeout should expose its compact seconds range`);
  }
  assert.equal(await page.locator("#advanced-settings .playlist-timeout-output").evaluateAll(outputs =>
    outputs.some(output => output.textContent?.includes(String.fromCharCode(215)))), false,
  "advanced timeout controls should not show multiplier values");
  const searchCardStyle = await page.locator("#advanced-settings .search-mode-card").evaluate(element => ({
    border: getComputedStyle(element).borderTopWidth,
    background: getComputedStyle(element).backgroundColor,
  }));
  assert.equal(searchCardStyle.border, "0px", "Search method should not have an outer frame");
  assert.equal(searchCardStyle.background, "rgba(0, 0, 0, 0)", "Search method should not have a card background");
  const stageAttemptsBox = await page.locator("#playlist-stage-retry-limit").boundingBox();
  const stageTimeoutBox = await page.locator("#playlist-starting-timeout-seconds").boundingBox();
  assert.ok(stageAttemptsBox && stageTimeoutBox &&
    Math.abs(stageAttemptsBox.x - stageTimeoutBox.x) <= 2 &&
    Math.abs(stageAttemptsBox.x + stageAttemptsBox.width - stageTimeoutBox.x - stageTimeoutBox.width) <= 2,
  `attempt buttons should align to the visible left and right ends of the slider track: ${JSON.stringify({ stageAttemptsBox, stageTimeoutBox })}`);
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
  assert.ok(searchTooltipBox, "Search method tooltip must be visible");
  assert.equal((await searchTooltip.textContent())?.includes("\n"), false,
    "Search method tooltip should wrap naturally without a forced sentence break");
  assert.equal(await searchTooltip.evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getClientRects().length;
  }), 2, "Search method tooltip should occupy exactly two naturally wrapped lines");
  assert.ok(Math.abs(searchTooltipBox.width - 300) <= 1,
    `Search method tooltip should be only slightly wider, got ${searchTooltipBox.width}px`);
  assert.ok(searchTooltipBox.x >= advancedBox.x && searchTooltipBox.y >= advancedBox.y &&
    searchTooltipBox.x + searchTooltipBox.width <= advancedBox.x + advancedBox.width &&
    searchTooltipBox.y + searchTooltipBox.height <= advancedBox.y + advancedBox.height,
  "Search method tooltip must remain inside Advanced settings");
  const englishTooltipLayout = {
    "advanced-settings-help": { width: 168, lines: 2 },
    "url-search-label": { width: 300, lines: 2 },
    "preview-startup-attempts-label": { width: 220, lines: 2 },
    "preview-startup-timeout-label": { width: 146, lines: 2 },
    "playlist-retries-label": { width: 136, lines: 2 },
    "playlist-starting-timeout-label": { width: 170, lines: 1 },
    "playlist-ready-timeout-label": { width: 130, lines: 2 },
    "playlist-request-timeout-label": { width: 138, lines: 2 },
  };
  const tooltipWhitespaceFailures = [];
  const tooltipTargetIds = Object.keys(englishTooltipLayout);
  for (const [targetId, expected] of Object.entries(englishTooltipLayout)) {
    await page.locator(`#${targetId}`).hover();
    const tooltipBox = await searchTooltip.boundingBox();
    const textMetrics = await searchTooltip.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()];
      return { count: lines.length, widest: Math.max(...lines.map(line => line.width)) };
    });
    assert.ok(tooltipBox, `${targetId} tooltip must be measurable`);
    assert.ok(Math.abs(tooltipBox.width - expected.width) <= 1,
      `${targetId} tooltip should use its manually selected English width`);
    assert.equal(textMetrics.count, expected.lines,
      `${targetId} tooltip should use its reviewed English line count`);
    if (expected.width - 24 - textMetrics.widest > 20) {
      tooltipWhitespaceFailures.push(`${targetId} English: ${JSON.stringify(textMetrics)}`);
    }
    assert.ok(tooltipBox.x >= advancedBox.x && tooltipBox.y >= advancedBox.y &&
      tooltipBox.x + tooltipBox.width <= advancedBox.x + advancedBox.width &&
      tooltipBox.y + tooltipBox.height <= advancedBox.y + advancedBox.height,
    `${targetId} tooltip must remain inside Advanced settings`);
  }
  assert.deepEqual(await searchTooltip.evaluate(element => {
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) return [];
    const lines = [];
    let previousTop;
    for (let index = 0; index < textNode.length; index++) {
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const top = Math.round(range.getBoundingClientRect().top);
      if (top !== previousTop) lines.push("");
      lines[lines.length - 1] += textNode.data[index];
      previousTop = top;
    }
    return lines.map(line => line.trim());
  }), ["Waits for YouTube’s", "response."],
  "Response timeout tooltip should break at the sentence's natural phrase boundary");
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
  assert.equal(await page.locator("#youtube-tab").textContent(), "YouTube");
  assert.equal(await page.locator("#playmium-tab").textContent(), "Playmium");
  assert.equal(await page.locator("#playlist-retention-label").textContent(), "待播保留上限");
  assert.ok(await page.locator("#playmium-main").evaluate(element => element.scrollWidth - element.clientWidth) <= 1,
    "Traditional Chinese main-panel copy should not overflow horizontally");
  await page.locator("#advanced-settings-open").click();
  assert.equal(await page.locator("#url-search-label").textContent(), "搜尋方式");
  assert.equal(await page.locator("#playmium-added-previews-heading").textContent(), "Playmium 延伸預覽");
  assert.equal(await page.locator("#url-search").textContent(), "影片網址");
  assert.equal(await page.locator("#playlist-retries-label").textContent(), "每階段嘗試上限");
  assert.ok(await page.locator("#advanced-settings").evaluate(element => element.scrollWidth - element.clientWidth) <= 1,
    "Traditional Chinese advanced-settings copy should not overflow horizontally");
  const zhAdvancedBox = await advancedSettings.boundingBox();
  assert.ok(zhAdvancedBox, "Traditional Chinese advanced settings must be measurable");
  const traditionalChineseTooltipLayout = {
    "advanced-settings-help": { width: 146, lines: 2 },
    "url-search-label": { width: 200, lines: 2 },
    "preview-startup-attempts-label": { width: 133, lines: 2 },
    "preview-startup-timeout-label": { width: 160, lines: 1 },
    "playlist-retries-label": { width: 110, lines: 2 },
    "playlist-starting-timeout-label": { width: 130, lines: 1 },
    "playlist-ready-timeout-label": { width: 142, lines: 1 },
    "playlist-request-timeout-label": { width: 150, lines: 1 },
  };
  for (const [targetId, expected] of Object.entries(traditionalChineseTooltipLayout)) {
    await page.locator(`#${targetId}`).hover();
    const tooltipBox = await searchTooltip.boundingBox();
    const textMetrics = await searchTooltip.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()];
      return { count: lines.length, widest: Math.max(...lines.map(line => line.width)) };
    });
    assert.ok(tooltipBox, `${targetId} Traditional Chinese tooltip must be measurable`);
    assert.ok(Math.abs(tooltipBox.width - expected.width) <= 1,
      `${targetId} tooltip should use its manually selected Traditional Chinese width`);
    assert.equal(textMetrics.count, expected.lines,
      `${targetId} tooltip should use its reviewed Traditional Chinese line count`);
    if (expected.width - 24 - textMetrics.widest > 20) {
      tooltipWhitespaceFailures.push(`${targetId} Traditional Chinese: ${JSON.stringify(textMetrics)}`);
    }
    assert.ok(tooltipBox.x >= zhAdvancedBox.x && tooltipBox.y >= zhAdvancedBox.y &&
      tooltipBox.x + tooltipBox.width <= zhAdvancedBox.x + zhAdvancedBox.width &&
      tooltipBox.y + tooltipBox.height <= zhAdvancedBox.y + zhAdvancedBox.height,
    `${targetId} Traditional Chinese tooltip must remain inside Advanced settings`);
  }
  assert.deepEqual(tooltipWhitespaceFailures, [],
    "manually sized English and Traditional Chinese tooltips should not leave excessive horizontal space");
  await page.locator("#advanced-settings-close").click();
  await page.locator("#youtube-tab").click();
  assert.equal(await page.locator("#subtitles-label").textContent(), "字幕");
  assert.equal(await page.locator("#auto-translate-label").textContent(), "自動翻譯");
  assert.equal(await page.locator("#speed-label").textContent(), "播放速度");
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
