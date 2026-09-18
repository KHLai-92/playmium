import { type PreviewDebugLogBatch, type PreviewDebugLogEntry } from "./preview-debug-log";
import { appendPreviewDebugLog } from "./preview-debug-log-store";

let writes = Promise.resolve();
chrome.runtime.onMessage.addListener((message: unknown) => {
  const batch = message as Partial<PreviewDebugLogBatch>;
  if (batch?.kind !== "preview-debug-log" || !Array.isArray(batch.entries) || batch.entries.length > 64 || typeof batch.version !== "string") return;
  const entries = batch.entries.filter((entry): entry is PreviewDebugLogEntry =>
    Boolean(entry && entry.schemaVersion === 1 && typeof entry.sessionId === "string" && entry.sessionId.length <= 100 &&
      Number.isSafeInteger(entry.sequence) && entry.sequence > 0 && typeof entry.at === "string" &&
      typeof entry.monotonicMs === "number" && typeof entry.event === "string" && entry.detail && typeof entry.detail === "object"));
  if (!entries.length) return;
  writes = writes.then(async () => {
    const root = await navigator.storage.getDirectory();
    await appendPreviewDebugLog(root, batch.version!, entries);
  }).catch(error => console.warn("Inline Preview debug log write failed", error));
  return writes;
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.tabs.sendMessage(tab.id, {
    kind: "open-inline-preview-control-panel",
    tab: "playmium",
  }).catch(() => {
    // The control panel exists only on YouTube pages where the content script
    // is installed. Clicking the action elsewhere is intentionally a no-op.
  });
});
