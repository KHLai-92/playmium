import {
  previewDebugLogDirectory,
  previewDebugLogVersion,
  type PreviewDebugLogEntry,
} from "./preview-debug-log.ts";

export const previewDebugLogMaximumBytes = 5 * 1024 * 1024;
export const previewDebugLogCompactionBytes = 4 * 1024 * 1024;

function safeVersion(value: string) {
  return /^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(value) ? value : previewDebugLogVersion;
}

export function previewDebugLogFileName(version: string) {
  return `inline-preview-v${safeVersion(version)}.jsonl`;
}

export async function appendPreviewDebugLog(
  root: FileSystemDirectoryHandle,
  version: string,
  entries: readonly PreviewDebugLogEntry[],
) {
  if (!entries.length) return;
  const directory = await root.getDirectoryHandle(previewDebugLogDirectory, { create: true });
  const handle = await directory.getFileHandle(previewDebugLogFileName(version), { create: true });
  const file = await handle.getFile();
  const payload = `${entries.map(entry => JSON.stringify(entry)).join("\n")}\n`;
  const encoder = new TextEncoder();

  if (file.size + encoder.encode(payload).byteLength > previewDebugLogMaximumBytes) {
    const compactionBytes = Math.max(previewDebugLogCompactionBytes,
      Math.min(previewDebugLogMaximumBytes, encoder.encode(payload).byteLength));
    const lines = `${await file.text()}${payload}`
      .split("\n")
      .filter(Boolean)
      .map(line => `${line}\n`);
    const retained: string[] = [];
    let retainedBytes = 0;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const lineBytes = encoder.encode(lines[index]).byteLength;
      if (retainedBytes + lineBytes > compactionBytes) break;
      retained.push(lines[index]);
      retainedBytes += lineBytes;
    }

    const writable = await handle.createWritable();
    try {
      await writable.write(retained.reverse().join(""));
    } finally {
      await writable.close();
    }
    return;
  }

  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    await writable.seek(file.size);
    await writable.write(payload);
  } finally {
    await writable.close();
  }
}
