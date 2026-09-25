type BrowserPreferenceStorage = Readonly<{
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}>;

export type PreviewPreferenceStorage = Readonly<{
  ready: Promise<void>;
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}>;

export function createPreviewPreferenceStorage(storage: BrowserPreferenceStorage,
    preferences: ReadonlyArray<Readonly<{ key: string; legacySuffix: string }>>): PreviewPreferenceStorage {
  const legacyPrefix = "skipAds.inlinePreview";
  const ready = storage.get(null).then(async values => {
    const stored = Object.entries(values);
    const updates: Record<string, unknown> = {};
    for (const preference of preferences) {
      if (Object.hasOwn(values, preference.key)) continue;
      const legacy = stored.find(([key]) => key.startsWith(legacyPrefix) && key.endsWith(preference.legacySuffix));
      if (legacy) updates[preference.key] = legacy[1];
    }
    if (Object.keys(updates).length) await storage.set(updates);
  }).catch(() => undefined);

  return {
    ready,
    async get(keys) {
      await ready;
      return storage.get(keys);
    },
    async set(values) {
      await ready;
      await storage.set(values);
    },
  };
}
