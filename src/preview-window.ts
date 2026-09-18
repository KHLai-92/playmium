export type PreviewRect = { left: number; top: number; width: number; height: number };
export function floatingRect(viewWidth: number, viewHeight: number, previous?: PreviewRect, ratio = 16 / 9): PreviewRect {
  const maxHeight = Math.max(1, viewHeight);
  const minHeight = viewHeight * .3;
  const preferred = previous?.height ?? Math.min(1360, Math.max(320, viewWidth * .72), viewWidth - 32, (viewHeight - 32) * ratio) / ratio;
  const height = Math.max(minHeight, Math.min(maxHeight, preferred));
  const width = height * ratio;
  return {
    width, height,
    left: Math.min(Math.max(Math.min(0, viewWidth - width), previous?.left ?? (viewWidth - width) / 2), Math.max(0, viewWidth - width)),
    top: Math.min(Math.max(0, previous?.top ?? (viewHeight - height) / 2), Math.max(0, viewHeight - height)),
  };
}
export function resizeRect(rect: PreviewRect, edge: string, dx: number, dy: number, viewWidth: number, viewHeight: number, ratio = rect.width / rect.height): PreviewRect {
  const horizontal = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0;
  const vertical = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0;
  const delta = horizontal && vertical ? (horizontal * dx * ratio + vertical * dy) / (ratio * ratio + 1) : horizontal ? horizontal * dx / ratio : vertical * dy;
  const sized = floatingRect(viewWidth, viewHeight, { ...rect, height: rect.height + delta }, ratio);
  const left = horizontal === -1 ? rect.left + rect.width - sized.width : horizontal === 1 ? rect.left : rect.left + (rect.width - sized.width) / 2;
  const top = vertical === -1 ? rect.top + rect.height - sized.height : vertical === 1 ? rect.top : rect.top + (rect.height - sized.height) / 2;
  return floatingRect(viewWidth, viewHeight, { ...sized, left, top }, ratio);
}
export function preferredQuality(available: string[]): string | undefined {
  if (available.includes("hd1080")) return "hd1080";
  return ["highres", "hd2880", "hd2160", "hd1440", "hd720", "large", "medium", "small", "tiny"].find(q => available.includes(q));
}
