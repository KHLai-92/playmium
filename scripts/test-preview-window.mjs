import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { floatingRect, resizeRect, preferredQuality } from "../src/preview-window.ts";

test("floating player starts centered at reference size and fits narrow/short windows", () => {
  for (const [width, height] of [[1920, 870], [1280, 720], [390, 700], [700, 300]]) {
    const rect = floatingRect(width, height);
    assert.ok(rect.width <= width && rect.height <= height);
    assert.equal(rect.left, (width - rect.width) / 2);
    assert.equal(rect.top, (height - rect.height) / 2);
    assert.ok(Math.abs(rect.width / rect.height - 16 / 9) < 1e-12);
  }
  assert.equal(floatingRect(1920, 870).width, 1360);
});

test("dragging and resizing keep the entire player reachable inside the viewport", () => {
  const rect = floatingRect(1280, 720);
  assert.equal(floatingRect(1280, 720, { ...rect, left: -500, top: -100 }).left, 0);
  const moved = floatingRect(800, 450, { ...rect, left: 1500, top: 900 });
  assert.equal(moved.left + moved.width, 800);
  assert.equal(moved.top + moved.height, 450);
});

test("1080p wins over higher resolutions; otherwise highest available wins regardless of order", () => {
  assert.equal(preferredQuality(["hd2160", "hd1080", "hd720"]), "hd1080");
  assert.equal(preferredQuality(["medium", "hd720", "hd1440"]), "hd1440");
  assert.equal(preferredQuality(["tiny", "large", "medium"]), "large");
  assert.equal(preferredQuality([]), undefined);
});

// These two source assertions intentionally remain: the emitted CSS is the
// browser artifact under test, not a private TypeScript implementation detail.
const compiled = await readFile("dist-preview-prototype/preview.js", "utf8");
test("fullscreen removes the floating frame, outline and shadow", () => {
  const selector = ".${hostClass}:fullscreen{";
  const at = compiled.indexOf(selector), start = at + selector.length;
  const rule = at < 0 ? "" : compiled.slice(start, compiled.indexOf("}", start));
  assert.match(rule, /border:none!important/);
  assert.match(rule, /outline:none!important/);
  assert.match(rule, /box-shadow:none!important/);
});

test("fullscreen removes the focus outline from the full-size controls panel", () => {
  const selector = ".${hostClass}:fullscreen #skip-ads-preview-prototype{";
  const at = compiled.indexOf(selector), start = at + selector.length;
  const rule = at < 0 ? "" : compiled.slice(start, compiled.indexOf("}", start));
  assert.match(rule, /outline:none!important/);
  assert.match(rule, /border:none!important/);
  assert.match(rule, /box-shadow:none!important/);
});

test("edge and corner resizing preserve native ratio, opposite anchors and height bounds", () => {
  for (const ratio of [16 / 9, 4 / 3, 9 / 16]) {
    const rect = { left: 400, top: 200, width: 400 * ratio, height: 400 };
    for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) {
      const resized = resizeRect(rect, edge, 80, 60, 1920, 1080, ratio);
      assert.ok(Math.abs(resized.width / resized.height - ratio) < 1e-10);
      assert.ok(resized.height >= 324 && resized.height <= 1080);
      if (edge.includes("w")) assert.ok(Math.abs(resized.left + resized.width - rect.left - rect.width) < 1e-10);
      if (edge.includes("n")) assert.ok(Math.abs(resized.top + resized.height - rect.top - rect.height) < 1e-10);
    }
    assert.equal(resizeRect(rect, "s", 0, -10000, 1920, 1080, ratio).height, 324);
    assert.equal(resizeRect(rect, "s", 0, 10000, 1920, 1080, ratio).height, 1080);
    const chosen = resizeRect(rect, "s", 0, 150, 1920, 1080, ratio);
    assert.equal(floatingRect(1920, 1080, chosen, ratio).height, chosen.height);
  }
});
