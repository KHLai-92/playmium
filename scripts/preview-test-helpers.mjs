// Shared user gestures for the standalone prototype's 0.0.8 entry flow.
export async function openPreviewPanel(page) {
  const panel = page.locator("#skip-ads-preview-prototype");
  await panel.waitFor({ state: "attached" });
  if (!(await panel.locator("#controls").isVisible())) await page.keyboard.press("Alt+p");
  return panel;
}
export async function enablePreviewMode(page) {
  const panel = await openPreviewPanel(page);
  if (await panel.locator("#enable").getAttribute("aria-checked") !== "true") await panel.locator("#enable").click();
  await page.keyboard.press("Alt+p");
}
export async function clickPlayingPreview(page) {
  const video = page.locator("#inline-preview-player video").first();
  const box = await video.boundingBox();
  if (!box) throw new Error("The real inline preview has no visible video bounds");
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.waitForSelector(".skip-ads-preview-prototype-video", { state: "attached", timeout: 5000 });
}
export async function samplePreviewAudio(page) {
  return page.evaluate(async () => {
    const video = document.querySelector(".skip-ads-preview-prototype-video");
    const stream = video.captureStream(), tracks = stream.getAudioTracks();
    if (!tracks.length) return { tracks: 0, peak: 0 };
    const context = new AudioContext(); await context.resume();
    const source = context.createMediaStreamSource(new MediaStream(tracks)), analyser = context.createAnalyser(); source.connect(analyser);
    let peak = 0;
    try {
      const values = new Float32Array(analyser.fftSize);
      for (let i = 0; i < 20; i++) {
        analyser.getFloatTimeDomainData(values); for (const value of values) peak = Math.max(peak, Math.abs(value));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return { tracks: tracks.length, peak, muted: video.muted, volume: video.volume };
    } finally { source.disconnect(); await context.close(); stream.getTracks().forEach(track => track.stop()); }
  });
}
