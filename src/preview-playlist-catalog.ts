import { emitPreviewDebugLog } from "./preview-debug-log.ts";

export type PlaylistLoadRequest = Readonly<{ videoId: string; playlistId: string }>;

export type PlaylistCatalog<T> = Readonly<{
  load(request: PlaylistLoadRequest, options?: { signal?: AbortSignal }): Promise<T>;
  dispose(): void;
}>;

type CatalogOptions = Readonly<{
  debugName?: string;
  capacity?: number;
  successTtlMs?: number;
  sweepIntervalMs?: number;
  now?: () => number;
  setInterval?: (callback: () => void, milliseconds: number) => unknown;
  clearInterval?: (timer: unknown) => void;
}>;

type ExpiringLruOptions<K, V> = CatalogOptions & Readonly<{
  onEvict?: (key: K, value: V, reason: "expired" | "capacity" | "deleted" | "disposed") => void;
}>;

function resolveCatalogRuntime(options: CatalogOptions) {
  return {
    capacity: options.capacity ?? 12,
    successTtlMs: options.successTtlMs ?? 5 * 60_000,
    sweepIntervalMs: options.sweepIntervalMs ?? 60_000,
    now: options.now ?? Date.now,
    schedule: options.setInterval ?? (typeof globalThis.setInterval === "function"
      ? ((callback: () => void, milliseconds: number) => globalThis.setInterval(callback, milliseconds))
      : (() => null)),
    cancelSchedule: options.clearInterval ?? (typeof globalThis.clearInterval === "function"
      ? (timer: unknown) => globalThis.clearInterval(timer as ReturnType<typeof setInterval>)
      : (() => {})),
  };
}

export function createExpiringLru<K, V>(options: ExpiringLruOptions<K, V> = {}) {
  const { capacity, successTtlMs, sweepIntervalMs, now, schedule, cancelSchedule } = resolveCatalogRuntime(options);
  const values = new Map<K, { value: V; expiresAt: number }>();
  const evict = (key: K, reason: "expired" | "capacity" | "deleted" | "disposed") => {
    const entry = values.get(key);
    if (!entry) return;
    values.delete(key);
    options.onEvict?.(key, entry.value, reason);
    if (options.debugName) emitPreviewDebugLog(reason === "expired" ? "resource.expire" : reason === "capacity" ? "resource.evict" : "resource.release",
      { resource: options.debugName, key: String(key), reason });
  };
  const sweep = () => {
    const at = now();
    for (const [key, entry] of values) if (entry.expiresAt <= at) evict(key, "expired");
  };
  const timer = schedule(sweep, sweepIntervalMs);
  return {
    get(key: K) {
      const entry = values.get(key);
      if (!entry || entry.expiresAt <= now()) { evict(key, "expired"); return undefined; }
      values.delete(key); values.set(key, entry);
      if (options.debugName) emitPreviewDebugLog("resource.hit", { resource: options.debugName, key: String(key) });
      return entry.value;
    },
    set(key: K, value: V) {
      if (values.has(key)) {
        values.delete(key);
        if (options.debugName) emitPreviewDebugLog("resource.release", { resource: options.debugName, key: String(key), reason: "replaced" });
      }
      values.set(key, { value, expiresAt: now() + successTtlMs });
      if (options.debugName) emitPreviewDebugLog("resource.create", { resource: options.debugName, key: String(key) });
      while (values.size > capacity) evict(values.keys().next().value as K, "capacity");
    },
    delete(key: K) { evict(key, "deleted"); },
    dispose() {
      cancelSchedule(timer);
      for (const key of [...values.keys()]) evict(key, "disposed");
    },
  };
}

export function createPlaylistCatalog<T>(
  fetchPlaylist: (request: PlaylistLoadRequest, options: { signal: AbortSignal }) => Promise<T | null>,
  options: CatalogOptions = {},
): PlaylistCatalog<T> {
  const { capacity, successTtlMs, sweepIntervalMs, now, schedule, cancelSchedule } = resolveCatalogRuntime(options);
  type Entry = {
    promise: Promise<T>;
    expiresAt: number;
    controller: AbortController;
    pending: boolean;
    subscribers: number;
    hasUncancelledCaller: boolean;
  };
  const entries = new Map<string, Entry>();
  let disposed = false;

  const remove = (key: string, entry: Entry, reason: "expired" | "capacity" | "cancelled" | "failed" | "disposed", abort = false) => {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    if (abort) entry.controller.abort();
    if (options.debugName) emitPreviewDebugLog(reason === "expired" ? "resource.expire" : reason === "capacity" ? "resource.evict" : "resource.release",
      { resource: options.debugName, key, reason, pending: entry.pending });
  };
  const sweep = () => {
    const at = now();
    for (const [key, entry] of entries) if (entry.expiresAt <= at) remove(key, entry, "expired");
  };
  const timer = schedule(sweep, sweepIntervalMs);

  const releaseSubscriber = (key: string, entry: Entry) => {
    entry.subscribers--;
    if (entry.pending && entry.subscribers === 0 && !entry.hasUncancelledCaller) remove(key, entry, "cancelled", true);
  };
  const withSignal = (key: string, entry: Entry, signal?: AbortSignal) => {
    if (!signal) { entry.hasUncancelledCaller = true; return entry.promise; }
    if (signal.aborted) return Promise.reject(new DOMException("Playlist load was cancelled.", "AbortError"));
    entry.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", cancel);
        releaseSubscriber(key, entry);
        callback();
      };
      const cancel = () => finish(() => reject(new DOMException("Playlist load was cancelled.", "AbortError")));
      signal.addEventListener("abort", cancel, { once: true });
      void entry.promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    });
  };

  return {
    load(request, requestOptions) {
      if (disposed) return Promise.reject(new Error("Playlist catalog is disposed."));
      if (requestOptions?.signal?.aborted) return Promise.reject(new DOMException("Playlist load was cancelled.", "AbortError"));
      const key = `${request.videoId}:${request.playlistId}`;
      const existing = entries.get(key);
      if (existing && existing.expiresAt > now()) {
        entries.delete(key);
        entries.set(key, existing);
        if (options.debugName) emitPreviewDebugLog("resource.hit", { resource: options.debugName, key, pending: existing.pending });
        return withSignal(key, existing, requestOptions?.signal);
      }
      if (existing) remove(key, existing, "expired", existing.expiresAt === Number.POSITIVE_INFINITY);
      const controller = new AbortController();
      const entry: Entry = {
        promise: Promise.resolve(null as never), expiresAt: Number.POSITIVE_INFINITY, controller,
        pending: true, subscribers: 0, hasUncancelledCaller: false,
      };
      entry.promise = fetchPlaylist(request, { signal: controller.signal }).then(result => {
        if (!result) throw new Error("Playlist information is unavailable.");
        entry.pending = false;
        if (entries.get(key) === entry) entry.expiresAt = now() + successTtlMs;
        return result;
      }, error => {
        entry.pending = false;
        throw error;
      });
      entries.set(key, entry);
      if (options.debugName) emitPreviewDebugLog("resource.create", { resource: options.debugName, key });
      while (entries.size > capacity) {
        const oldestKey = entries.keys().next().value as string;
        const oldest = entries.get(oldestKey)!;
        remove(oldestKey, oldest, "capacity", oldest.expiresAt === Number.POSITIVE_INFINITY);
      }
      void entry.promise.catch(() => remove(key, entry, "failed"));
      return withSignal(key, entry, requestOptions?.signal);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelSchedule(timer);
      for (const [key, entry] of entries) remove(key, entry, "disposed", true);
    },
  };
}
