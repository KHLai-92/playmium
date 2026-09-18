import assert from "node:assert/strict";
import test from "node:test";
import { previewAnimationSpec } from "../src/preview-animation.ts";

test("preview animation exposes stable opening and closing geometry", () => {
  const opening = previewAnimationSpec(true);
  assert.equal(opening.options.duration, 720);
  assert.equal(opening.options.fill, "both");
  assert.equal(opening.frames[0].filter, "opacity(0) brightness(.65)");
  assert.equal(opening.frames.at(-1).filter, "opacity(1) brightness(1)");

  const current = { scale: ".8", translate: "0 20px", filter: "opacity(.7)" };
  const closing = previewAnimationSpec(false, current);
  assert.equal(closing.options.duration, 280);
  assert.deepEqual(closing.frames[0], current, "closing must start at the currently rendered frame");
  assert.equal(closing.frames.at(-1).filter, "opacity(0) brightness(.9)");
});
