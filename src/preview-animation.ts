const shownFrame: Keyframe = { scale: "1", translate: "0 0", filter: "opacity(1) brightness(1)" };

export function previewAnimationSpec(opening: boolean, start?: Keyframe): {
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
} {
  return opening ? {
    frames: [
      { scale: ".52", translate: "0 64px", filter: "opacity(0) brightness(.65)", offset: 0 },
      { scale: ".91", translate: "0 12px", filter: "opacity(1) brightness(1)", offset: .65 },
      shownFrame,
    ],
    options: { duration: 720, easing: "cubic-bezier(.22,.65,.28,1)", fill: "both" },
  } : {
    frames: [start ?? shownFrame, { scale: ".92", translate: "0 12px", filter: "opacity(0) brightness(.9)" }],
    options: { duration: 280, easing: "cubic-bezier(.4,0,.6,1)", fill: "both" },
  };
}
