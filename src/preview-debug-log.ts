declare const __INLINE_PREVIEW_VERSION__: string;

export const previewDebugLogEvent = "skip-ads-preview-debug-log";
export const previewDebugLogDirectory = "debug-logs";
export const previewDebugLogVersion = typeof __INLINE_PREVIEW_VERSION__ === "string"
  ? __INLINE_PREVIEW_VERSION__
  : "development";
export const previewDiagnosticsSchemaVersion = 1;
export const previewDiagnosticsMaximumEntries = 20_000;

export type PreviewDebugLogEmission = Readonly<{
  at: string;
  monotonicMs: number;
  event: string;
  detail: Readonly<Record<string, unknown>>;
}>;

export type PreviewDebugLogEntry = PreviewDebugLogEmission & Readonly<{
  schemaVersion: typeof previewDiagnosticsSchemaVersion;
  sessionId: string;
  sequence: number;
}>;

export type PreviewDebugLogBatch = Readonly<{
  kind: "preview-debug-log";
  version: string;
  entries: readonly PreviewDebugLogEntry[];
}>;

const enabledAttribute = "data-skip-preview-debug-log";
export const defaultPreviewLogAutoSaveEnabled = false;

type PreviewLogAutoSavePreferenceStorage = Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, boolean>): Promise<void>;
}>;

export function resolvePreviewLogAutoSaveEnabled(value: unknown) {
  return typeof value === "boolean" ? value : defaultPreviewLogAutoSaveEnabled;
}

export async function loadPreviewLogAutoSavePreference(storage: PreviewLogAutoSavePreferenceStorage, key: string) {
  const values = await storage.get(key);
  return resolvePreviewLogAutoSaveEnabled(values[key]);
}

export function savePreviewLogAutoSavePreference(storage: PreviewLogAutoSavePreferenceStorage, key: string, enabled: boolean) {
  return storage.set({ [key]: enabled });
}

export function previewDebugLoggingEnabled(root: Pick<Element, "getAttribute"> | null = globalThis.document?.documentElement ?? null) {
  return root?.getAttribute?.(enabledAttribute) === "true";
}

export function setPreviewDebugLoggingEnabled(enabled: boolean, root: Element | null = globalThis.document?.documentElement ?? null) {
  root?.setAttribute(enabledAttribute, String(enabled));
}

/** Capture is always enabled by the isolated-world session owner; this guard keeps other documents cheap. */
export function emitPreviewDebugLog(event: string, detail: Record<string, unknown> = {}, target: Document = document) {
  if (!previewDebugLoggingEnabled(target.documentElement)) return false;
  const entry: PreviewDebugLogEmission = {
    at: new Date().toISOString(),
    monotonicMs: Math.round(performance.now() * 10) / 10,
    event,
    detail,
  };
  target.dispatchEvent(new CustomEvent(previewDebugLogEvent, { detail: JSON.stringify(entry) }));
  return true;
}

type BatchScheduler = Readonly<{
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
  send(batch: PreviewDebugLogBatch): void | Promise<void>;
}>;

export function createPreviewDebugLogBatcher(
  version: string,
  runtime: BatchScheduler,
  options: { batchSize?: number; flushIntervalMs?: number } = {},
) {
  const batchSize = options.batchSize ?? 32;
  const flushIntervalMs = options.flushIntervalMs ?? 250;
  let entries: PreviewDebugLogEntry[] = [];
  let timer: unknown = null;
  const flush = () => {
    if (timer !== null) runtime.cancel(timer);
    timer = null;
    if (!entries.length) return;
    const batch = entries;
    entries = [];
    void runtime.send({ kind: "preview-debug-log", version, entries: batch });
  };
  return {
    accept(entry: PreviewDebugLogEntry) {
      entries.push(entry);
      if (entries.length >= batchSize) flush();
      else if (timer === null) timer = runtime.schedule(flush, flushIntervalMs);
    },
    flush,
    pending() { return entries.length; },
  };
}

type PreviewDiagnosticsRuntime = BatchScheduler & Readonly<{
  now(): Readonly<{ at: string; monotonicMs: number }>;
  createSessionId(): string;
}>;

export type PreviewDiagnosticsExport = Readonly<{
  kind: "inline-preview-diagnostics";
  schemaVersion: typeof previewDiagnosticsSchemaVersion;
  version: string;
  session: Readonly<{
    id: string;
    startedAt: string;
    exportedAt: string;
    autoSave: boolean;
    entryCount: number;
    droppedEntries: number;
    firstSequence: number | null;
    lastSequence: number | null;
  }>;
  entries: readonly PreviewDebugLogEntry[];
}>;

export function createPreviewDiagnosticsSession(
  version: string,
  runtime: PreviewDiagnosticsRuntime,
  options: { sessionId?: string; maximumEntries?: number; batchSize?: number; flushIntervalMs?: number } = {},
) {
  const sessionId = options.sessionId ?? runtime.createSessionId();
  const maximumEntries = options.maximumEntries ?? previewDiagnosticsMaximumEntries;
  if (!sessionId || !Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
    throw new TypeError("A diagnostics session requires an id and positive entry capacity.");
  }
  const startedAt = runtime.now().at;
  const entries: PreviewDebugLogEntry[] = [];
  let oldestEntryIndex = 0;
  const batcher = createPreviewDebugLogBatcher(version, runtime, options);
  let sequence = 0;
  let queuedThroughSequence = 0;
  let droppedEntries = 0;
  let autoSave = false;
  const retainedEntries = () => droppedEntries === 0
    ? entries.slice()
    : [...entries.slice(oldestEntryIndex), ...entries.slice(0, oldestEntryIndex)];

  const accept = (emission: PreviewDebugLogEmission) => {
    const entry: PreviewDebugLogEntry = {
      schemaVersion: previewDiagnosticsSchemaVersion,
      sessionId,
      sequence: ++sequence,
      at: emission.at,
      monotonicMs: emission.monotonicMs,
      event: emission.event,
      detail: emission.detail,
    };
    if (entries.length < maximumEntries) entries.push(entry);
    else {
      entries[oldestEntryIndex] = entry;
      oldestEntryIndex = (oldestEntryIndex + 1) % maximumEntries;
      droppedEntries++;
    }
    if (autoSave) {
      batcher.accept(entry);
      queuedThroughSequence = entry.sequence;
    }
    return entry;
  };

  return {
    accept,
    record(event: string, detail: Record<string, unknown> = {}) {
      const timing = runtime.now();
      return accept({ at: timing.at, monotonicMs: timing.monotonicMs, event, detail });
    },
    setAutoSave(value: boolean) {
      if (value === autoSave) return;
      if (!value) {
        batcher.flush();
        autoSave = false;
        return;
      }
      autoSave = true;
      for (const entry of retainedEntries()) {
        if (entry.sequence > queuedThroughSequence) batcher.accept(entry);
      }
      queuedThroughSequence = sequence;
    },
    autoSaveEnabled() { return autoSave; },
    exportCurrent(): PreviewDiagnosticsExport {
      const exportedAt = runtime.now().at;
      const retained = retainedEntries();
      return {
        kind: "inline-preview-diagnostics",
        schemaVersion: previewDiagnosticsSchemaVersion,
        version,
        session: {
          id: sessionId,
          startedAt,
          exportedAt,
          autoSave,
          entryCount: retained.length,
          droppedEntries,
          firstSequence: retained[0]?.sequence ?? null,
          lastSequence: retained.at(-1)?.sequence ?? null,
        },
        entries: retained,
      };
    },
    flush: batcher.flush,
    pending: batcher.pending,
  };
}

export function installPreviewDiagnosticsSession(target: Document = document) {
  setPreviewDebugLoggingEnabled(true, target.documentElement);
  const session = createPreviewDiagnosticsSession(previewDebugLogVersion, {
    schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    send: batch => chrome.runtime.sendMessage(batch).catch(() => {}),
    now: () => ({
      at: new Date().toISOString(),
      monotonicMs: Math.round(performance.now() * 10) / 10,
    }),
    createSessionId: () => crypto.randomUUID(),
  });
  session.record("diagnostics.session-start", { version: previewDebugLogVersion });
  const receive = (event: Event) => {
    const detail = (event as CustomEvent<string>).detail;
    if (typeof detail !== "string" || detail.length > 16_384) return;
    try {
      const emission = JSON.parse(detail) as PreviewDebugLogEmission;
      if (typeof emission?.at === "string" && typeof emission?.monotonicMs === "number" &&
          typeof emission?.event === "string" && emission.detail && typeof emission.detail === "object") {
        session.accept(emission);
      }
    } catch { /* Ignore malformed cross-world diagnostics. */ }
  };
  target.addEventListener(previewDebugLogEvent, receive);
  let ended = false;
  const finish = (reason: "pagehide" | "dispose") => {
    if (!ended) {
      ended = true;
      session.record("diagnostics.session-end", { reason });
    }
    session.flush();
  };
  const pagehide = () => finish("pagehide");
  window.addEventListener("pagehide", pagehide, { once: true });
  return {
    ...session,
    dispose() {
      target.removeEventListener(previewDebugLogEvent, receive);
      window.removeEventListener("pagehide", pagehide);
      finish("dispose");
    },
  };
}
