export const previewUrlSearchKey = "skipAds.inlinePreviewPrototype.urlSearchEnabled";
export const previewSearchModeEvent = "skip-ads-preview-search-mode";
export const defaultPreviewUrlSearchEnabled = true;

type SearchPreferenceStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
};

// A user change or another tab's update wins over an older asynchronous load.
export function createPreviewSearchPreference(storage: SearchPreferenceStorage, apply: (enabled: boolean) => void) {
  let revision = 0;
  const normalize = (value: unknown) => typeof value === "boolean" ? value : defaultPreviewUrlSearchEnabled;
  const ready = storage.get(previewUrlSearchKey).then(values => {
    if (revision === 0) apply(normalize(values[previewUrlSearchKey]));
  }, () => {
    if (revision === 0) apply(defaultPreviewUrlSearchEnabled);
  });
  const receive = (value: unknown) => { revision++; apply(normalize(value)); };
  return {
    ready,
    receive,
    set(value: boolean) {
      receive(value);
      return storage.set({ [previewUrlSearchKey]: normalize(value) });
    },
  };
}
