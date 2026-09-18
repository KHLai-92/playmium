export type PreviewUiLanguage = "en" | "zh-TW";

export const defaultPreviewUiLanguage: PreviewUiLanguage = "en";

export type PreviewUiCopy = Readonly<{
  controlPanel: string;
  closeSettings: string;
  youtube: string;
  inlineVideoPreviews: string;
  enableInlineVideoPreviews: string;
  interfaceLanguage: string;
  english: string;
  traditionalChinese: string;
  previewStartup: string;
  urlSearch: string;
  urlSearchVideoId: string;
  urlSearchFullUrl: string;
  settingsSaveFailed: string;
  previewStartupTimeout: string;
  previewStartupAttempts: string;
  playlistPreviews: string;
  playlistPreviewsKeptReady: string;
  retriesPerLoadingStep: string;
  playlistLoadingTimeouts: string;
  preparePreview: string;
  startPlayer: string;
  loadVideo: string;
  preparePreviewTimeout: string;
  startPlayerTimeout: string;
  loadVideoTimeout: string;
  restoreAllDefaults: string;
  restoreAllDefaultsTitle: string;
  audioTest: string;
  audioWorks: string;
  noAudio: string;
  troubleshooting: string;
  autoSaveLogs: string;
  autoSaveLogsOn: string;
  autoSaveLogsOff: string;
  downloadCurrentLog: string;
  subtitles: string;
  subtitleLanguage: string;
  autoTranslate: string;
  subtitleTranslation: string;
  speed: string;
  playbackSpeed: string;
  quality: string;
  videoQuality: string;
  on: string;
  off: string;
  timeoutDescription(multiplier: number, seconds: number): string;
  seconds(value: number): string;
  attempts(value: number): string;
  retries(value: number): string;
  readyPreviews(value: number): string;
  autoplayNext(enabled: boolean): string;
}>;

const english: PreviewUiCopy = {
  controlPanel: "Control panel",
  closeSettings: "Close settings",
  youtube: "YouTube",
  inlineVideoPreviews: "Inline video previews",
  enableInlineVideoPreviews: "Enable inline video previews",
  interfaceLanguage: "Interface language",
  english: "English",
  traditionalChinese: "Traditional Chinese",
  previewStartup: "Preview startup",
  urlSearch: "Preview search",
  urlSearchVideoId: "Video ID",
  urlSearchFullUrl: "Full URL",
  settingsSaveFailed: "This page uses your choice, but it could not be saved. Please try again.",
  previewStartupTimeout: "Preview startup timeout",
  previewStartupAttempts: "Preview startup attempts",
  playlistPreviews: "Playlist previews",
  playlistPreviewsKeptReady: "Playlist previews kept ready",
  retriesPerLoadingStep: "Retries per loading step",
  playlistLoadingTimeouts: "Playlist loading timeouts",
  preparePreview: "Prepare preview",
  startPlayer: "Start player",
  loadVideo: "Load video",
  preparePreviewTimeout: "Prepare playlist preview timeout",
  startPlayerTimeout: "Start playlist player timeout",
  loadVideoTimeout: "Load playlist video timeout",
  restoreAllDefaults: "Restore all defaults",
  restoreAllDefaultsTitle: "Restore every persistent Playmium setting to its original value",
  audioTest: "Audio test:",
  audioWorks: "Audio works",
  noAudio: "No audio",
  troubleshooting: "Troubleshooting",
  autoSaveLogs: "Auto-save logs",
  autoSaveLogsOn: "Auto-save is on.",
  autoSaveLogsOff: "Current log is available for download.",
  downloadCurrentLog: "Download current log",
  subtitles: "Subtitles",
  subtitleLanguage: "Subtitle language",
  autoTranslate: "Auto-translate",
  subtitleTranslation: "Subtitle translation",
  speed: "Speed",
  playbackSpeed: "Playback speed",
  quality: "Quality",
  videoQuality: "Video quality",
  on: "On",
  off: "Off",
  timeoutDescription: (multiplier, seconds) => `${multiplier} times the standard timeout; ${seconds} seconds`,
  seconds: value => `${value} s`,
  attempts: value => `${value} attempt${value === 1 ? "" : "s"}`,
  retries: value => `${value} ${value === 1 ? "retry" : "retries"}`,
  readyPreviews: value => `${value} preview${value === 1 ? "" : "s"} kept ready`,
  autoplayNext: enabled => `Autoplay next playlist video: ${enabled ? "On" : "Off"}`,
};

const traditionalChinese: PreviewUiCopy = {
  controlPanel: "控制面板",
  closeSettings: "關閉設定",
  youtube: "YouTube",
  inlineVideoPreviews: "站內影片預覽",
  enableInlineVideoPreviews: "啟用站內影片預覽",
  interfaceLanguage: "介面語言",
  english: "English",
  traditionalChinese: "繁體中文",
  previewStartup: "預覽啟動",
  urlSearch: "預覽搜尋",
  urlSearchVideoId: "影片 ID",
  urlSearchFullUrl: "完整網址",
  settingsSaveFailed: "此頁已套用設定，但無法儲存，請再試一次。",
  previewStartupTimeout: "預覽啟動逾時",
  previewStartupAttempts: "預覽啟動嘗試次數",
  playlistPreviews: "播放清單預覽",
  playlistPreviewsKeptReady: "保留待播的清單預覽",
  retriesPerLoadingStep: "各載入步驟重試次數",
  playlistLoadingTimeouts: "播放清單載入逾時",
  preparePreview: "準備預覽",
  startPlayer: "啟動播放器",
  loadVideo: "載入影片",
  preparePreviewTimeout: "準備播放清單預覽的逾時",
  startPlayerTimeout: "啟動播放清單播放器的逾時",
  loadVideoTimeout: "載入播放清單影片的逾時",
  restoreAllDefaults: "全部恢復預設值",
  restoreAllDefaultsTitle: "將所有持久化的 Playmium 設定恢復為原始值",
  audioTest: "音訊測試：",
  audioWorks: "聽得到聲音",
  noAudio: "沒有聲音",
  troubleshooting: "疑難排解",
  autoSaveLogs: "自動儲存紀錄",
  autoSaveLogsOn: "自動儲存已開啟。",
  autoSaveLogsOff: "目前紀錄可供下載。",
  downloadCurrentLog: "下載目前紀錄",
  subtitles: "字幕",
  subtitleLanguage: "字幕語言",
  autoTranslate: "自動翻譯",
  subtitleTranslation: "字幕翻譯",
  speed: "速度",
  playbackSpeed: "播放速度",
  quality: "畫質",
  videoQuality: "影片畫質",
  on: "開",
  off: "關",
  timeoutDescription: (multiplier, seconds) => `標準逾時的 ${multiplier} 倍；${seconds} 秒`,
  seconds: value => `${value} 秒`,
  attempts: value => `${value} 次嘗試`,
  retries: value => `${value} 次重試`,
  readyPreviews: value => `保留 ${value} 個待播預覽`,
  autoplayNext: enabled => `自動播放清單下一部影片：${enabled ? "開" : "關"}`,
};

export function normalizePreviewUiLanguage(value: unknown): PreviewUiLanguage {
  return value === "zh-TW" ? "zh-TW" : defaultPreviewUiLanguage;
}

export function previewUiCopy(language: unknown): PreviewUiCopy {
  return normalizePreviewUiLanguage(language) === "zh-TW" ? traditionalChinese : english;
}

type PreviewUiLanguageStorage = Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}>;

export async function loadPreviewUiLanguage(storage: PreviewUiLanguageStorage, key: string): Promise<PreviewUiLanguage> {
  const values = await storage.get(key);
  return normalizePreviewUiLanguage(values[key]);
}

export function savePreviewUiLanguage(storage: PreviewUiLanguageStorage, key: string, language: unknown) {
  return storage.set({ [key]: normalizePreviewUiLanguage(language) });
}
