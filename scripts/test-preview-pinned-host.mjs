import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

function pinnedPreviewCss(compiled) {
  const marker = "/* YouTube disables pointer events on a finished preview.";
  const markerAt = compiled.indexOf(marker);
  assert.notEqual(markerAt, -1, "compiled preview CSS must contain the pinned-player rules");
  const start = compiled.lastIndexOf("`", markerAt) + 1;
  const end = compiled.indexOf("`;", markerAt);
  assert.ok(start > 0 && end > start, "compiled pinned-player CSS must remain extractable");
  return compiled.slice(start, end)
    .replaceAll("${pinnedPreviewHostSelector}", ":is(ytd-video-preview,#inline-preview-player,#video-preview,[data-skip-preview-owned]):has(> #playmium-preview)")
    .replaceAll(".${hostClass}", ".playmium-preview-pinned")
    .replaceAll(".${ancestorClass}", ".playmium-preview-ancestor")
    .replaceAll(".${videoClass}", ".playmium-preview-video");
}

test("YouTube class rewrites cannot hide a preview containing Playmium controls", async () => {
  const compiled = await readFile("dist-playmium/preview.js", "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.setContent(`<!doctype html><style>
      ytd-video-preview { display:flex; opacity:0; position:absolute; z-index:auto; overflow:visible }
      ytd-video-preview.ytdVideoPreviewHidePlayerControls .ytdVideoPreviewPlayerContainerWrapper { opacity:0 }
    </style><ytd-video-preview class="ytdVideoPreviewHost playmium-preview-pinned"
      style="--skip-preview-left:100px;--skip-preview-top:80px;--skip-preview-width:800px;--skip-preview-height:450px">
      <div class="ytdVideoPreviewPlayerContainerWrapper playmium-preview-ancestor">
        <div class="playmium-preview-ancestor"><video class="playmium-preview-video"></video></div>
      </div>
      <aside id="playmium-preview"></aside>
    </ytd-video-preview>`);
    await page.addStyleTag({ content: pinnedPreviewCss(compiled) });
    const host = page.locator("ytd-video-preview");

    await host.evaluate(element => {
      element.className = "ytdVideoPreviewHost ytdVideoPreviewHidePlayerControls ytdVideoPreviewRoundedCornersLarge";
    });

    assert.deepEqual(await host.evaluate(element => {
      const style = getComputedStyle(element);
      return { display: style.display, opacity: style.opacity, position: style.position, zIndex: style.zIndex };
    }), { display: "block", opacity: "1", position: "fixed", zIndex: "2147483646" });
    assert.equal(await page.locator(".ytdVideoPreviewPlayerContainerWrapper").evaluate(element => getComputedStyle(element).opacity), "1");
    assert.equal(await page.locator("video").evaluate(element => getComputedStyle(element).objectFit), "contain");
  } finally {
    await browser.close();
  }
});
