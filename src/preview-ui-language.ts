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
  videoDescriptionAndComments: string;
  closeDescriptionAndComments: string;
  videoDetails: string;
  description: string;
  comments: string;
  showMore: string;
  showLess: string;
  couldNotLoadContent: string;
  tryAgain: string;
  loadingDescription: string;
  descriptionUnavailable: string;
  openPreviewFirst: string;
  creator: string;
  likes(value: string): string;
  viewReplies: string;
  hideReplies: string;
  loadingReplies: string;
  repliesUnavailable: string;
  loadMoreReplies: string;
  repliesCouldNotBeLoaded: string;
  loadingComments: string;
  commentsUnavailable: string;
  loadMoreComments: string;
  commentsCouldNotBeLoaded: string;
  noCommentsToShow: string;
  commentsUnavailableForVideo: string;
  commentPageUnavailable: string;
  videoInformationCouldNotBeLoaded: string;
  videoInformationTooLarge: string;
  videoInformationUnavailable: string;
  playLabel: string;
  pauseLabel: string;
  playTooltip: string;
  pauseTooltip: string;
  previousPlaylistVideo: string;
  nextPlaylistVideo: string;
  showSubtitles: string;
  hideSubtitles: string;
  subtitlesShortcut: string;
  enterFullscreen: string;
  exitFullscreen: string;
  enterFullscreenTooltip: string;
  exitFullscreenTooltip: string;
  settingsShortcut: string;
  closePreview: string;
  descriptionAndComments: string;
  mute: string;
  unmute: string;
  videoProgress: string;
  volume: string;
  progressOf(elapsed: string, total: string): string;
  chaptersLabel: string;
  viewChapters: string;
  closeChapters: string;
  chaptersCurrent(title: string): string;
  noChapters: string;
  loadingChapters: string;
  openPreviewForChapters: string;
  playlistLabel: string;
  autoplayNextLabel: string;
  previewNavigation: string;
  videosInPlaylist: string;
  closePlaylist: string;
  playlistUnavailableRetry: string;
  playlistLoading: string;
  loadingPlaylist: string;
  playlistPosition(position: string): string;
  playlistInteractionHint(position: string): string;
  hoverToPrepare: string;
  clickToPlay: string;
  preparingPreview: string;
  previewReady: string;
  previewUnavailable: string;
  previewPlaying: string;
  nativePreviewReadyStartingPlayback: string;
  preparingNativePreview(title: string): string;
  preparingPreferredResolution: string;
  settingsRestoredSaveFailed: string;
  hideShowControlsShortcut: string;
  mutedFeedback: string;
  startingVideo: string;
  retryingPreview(attempt: number, total: number): string;
  inlinePreviewControlPanel: string;
  controlPanelSections: string;
  previewUnavailableNoVideo: string;
  unavailable: string;
  previewError(message: string): string;
  advancedSettings: string;
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
  traditionalChinese: "繁體中文",
  previewStartup: "Preview startup",
  urlSearch: "Preview search",
  urlSearchVideoId: "Video ID",
  urlSearchFullUrl: "Full URL",
  settingsSaveFailed: "This page uses your choice, but it could not be saved. Please try again.",
  previewStartupTimeout: "Preview startup timeout",
  previewStartupAttempts: "Preview startup attempts",
  playlistPreviews: "Playlist previews",
  playlistPreviewsKeptReady: "Preloaded playlist previews",
  retriesPerLoadingStep: "Retries per loading step",
  playlistLoadingTimeouts: "Playlist loading timeouts",
  preparePreview: "Prepare preview",
  startPlayer: "Start player",
  loadVideo: "Load video",
  preparePreviewTimeout: "Prepare preview timeout",
  startPlayerTimeout: "Start player timeout",
  loadVideoTimeout: "Load video timeout",
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
  videoDescriptionAndComments: "Video description and comments",
  closeDescriptionAndComments: "Close description and comments",
  videoDetails: "Video details",
  description: "Description",
  comments: "Comments",
  showMore: "Show more",
  showLess: "Show less",
  couldNotLoadContent: "Could not load this content.",
  tryAgain: "Try again",
  loadingDescription: "Loading description…",
  descriptionUnavailable: "Description is unavailable.",
  openPreviewFirst: "Open a preview first.",
  creator: "Creator",
  likes: value => `${value} likes`,
  viewReplies: "View replies",
  hideReplies: "Hide replies",
  loadingReplies: "Loading replies…",
  repliesUnavailable: "Replies are unavailable.",
  loadMoreReplies: "Load more replies",
  repliesCouldNotBeLoaded: "Replies could not be loaded.",
  loadingComments: "Loading comments…",
  commentsUnavailable: "Comments are unavailable.",
  loadMoreComments: "Load more comments",
  commentsCouldNotBeLoaded: "Comments could not be loaded.",
  noCommentsToShow: "No comments to show.",
  commentsUnavailableForVideo: "Comments are unavailable for this video.",
  commentPageUnavailable: "That comment page is no longer available.",
  videoInformationCouldNotBeLoaded: "Video information could not be loaded.",
  videoInformationTooLarge: "Video information was too large.",
  videoInformationUnavailable: "Video information is unavailable.",
  playLabel: "Play",
  pauseLabel: "Pause",
  playTooltip: "Play (K / Space)",
  pauseTooltip: "Pause (K / Space)",
  previousPlaylistVideo: "Previous playlist video (Shift+P)",
  nextPlaylistVideo: "Next playlist video (Shift+N)",
  showSubtitles: "Show subtitles (C)",
  hideSubtitles: "Hide subtitles (C)",
  subtitlesShortcut: "Subtitles (C)",
  enterFullscreen: "Enter fullscreen",
  exitFullscreen: "Exit fullscreen",
  enterFullscreenTooltip: "Fullscreen (F)",
  exitFullscreenTooltip: "Exit fullscreen (F / Esc)",
  settingsShortcut: "Settings (Alt+P)",
  closePreview: "Close preview",
  descriptionAndComments: "Description and comments",
  mute: "Mute",
  unmute: "Unmute",
  videoProgress: "Video progress",
  volume: "Volume",
  progressOf: (elapsed, total) => `${elapsed} of ${total}`,
  chaptersLabel: "Chapters",
  viewChapters: "View chapters",
  closeChapters: "Close chapters",
  chaptersCurrent: title => `Chapters: ${title}`,
  noChapters: "This video has no chapters.",
  loadingChapters: "Loading chapters…",
  openPreviewForChapters: "Open a preview to view chapters.",
  playlistLabel: "Playlist",
  autoplayNextLabel: "Autoplay next",
  previewNavigation: "Preview navigation",
  videosInPlaylist: "Videos in this playlist",
  closePlaylist: "Close playlist",
  playlistUnavailableRetry: "Playlist unavailable, retry",
  playlistLoading: "Playlist, loading",
  loadingPlaylist: "Loading playlist…",
  playlistPosition: position => `Playlist, ${position}`,
  playlistInteractionHint: position => `${position} · select a video`,
  hoverToPrepare: "Hover to prepare",
  clickToPlay: "Click to play",
  preparingPreview: "Preparing preview…",
  previewReady: "Ready",
  previewUnavailable: "Preview unavailable",
  previewPlaying: "Playing",
  nativePreviewReadyStartingPlayback: "Native preview ready. Starting playback…",
  preparingNativePreview: title => `Preparing YouTube's native preview for “${title}”…`,
  preparingPreferredResolution: "Preparing preferred resolution…",
  settingsRestoredSaveFailed: "Settings were restored for this page but could not be saved",
  hideShowControlsShortcut: "Hide/show controls: Alt+P",
  mutedFeedback: "Muted",
  startingVideo: "Starting video…",
  retryingPreview: (attempt, total) => `Retrying preview (${attempt} / ${total})…`,
  inlinePreviewControlPanel: "Inline Preview control panel",
  controlPanelSections: "Control panel sections",
  previewUnavailableNoVideo: "Preview unavailable. YouTube has not supplied video yet. Try again or close the preview.",
  unavailable: "Unavailable",
  previewError: message => message,
  advancedSettings: "Advanced settings",
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
  playlistPreviewsKeptReady: "預載清單預覽",
  retriesPerLoadingStep: "各載入步驟重試次數",
  playlistLoadingTimeouts: "播放清單載入逾時",
  preparePreview: "準備預覽",
  startPlayer: "啟動播放器",
  loadVideo: "載入影片",
  preparePreviewTimeout: "準備預覽逾時",
  startPlayerTimeout: "啟動播放器逾時",
  loadVideoTimeout: "載入影片逾時",
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
  videoDescriptionAndComments: "影片說明與留言",
  closeDescriptionAndComments: "關閉影片說明與留言",
  videoDetails: "影片資訊",
  description: "說明",
  comments: "留言",
  showMore: "顯示更多",
  showLess: "顯示較少",
  couldNotLoadContent: "無法載入此內容。",
  tryAgain: "再試一次",
  loadingDescription: "正在載入說明…",
  descriptionUnavailable: "無法取得影片說明。",
  openPreviewFirst: "請先開啟預覽。",
  creator: "創作者",
  likes: value => `${value} 個喜歡`,
  viewReplies: "查看回覆",
  hideReplies: "隱藏回覆",
  loadingReplies: "正在載入回覆…",
  repliesUnavailable: "無法取得回覆。",
  loadMoreReplies: "載入更多回覆",
  repliesCouldNotBeLoaded: "無法載入回覆。",
  loadingComments: "正在載入留言…",
  commentsUnavailable: "無法取得留言。",
  loadMoreComments: "載入更多留言",
  commentsCouldNotBeLoaded: "無法載入留言。",
  noCommentsToShow: "沒有留言可顯示。",
  commentsUnavailableForVideo: "這部影片沒有可用的留言。",
  commentPageUnavailable: "此留言頁面已無法使用。",
  videoInformationCouldNotBeLoaded: "無法載入影片資訊。",
  videoInformationTooLarge: "影片資訊過大，無法載入。",
  videoInformationUnavailable: "無法取得影片資訊。",
  playLabel: "播放",
  pauseLabel: "暫停",
  playTooltip: "播放（K / 空白鍵）",
  pauseTooltip: "暫停（K / 空白鍵）",
  previousPlaylistVideo: "上一部播放清單影片（Shift+P）",
  nextPlaylistVideo: "下一部播放清單影片（Shift+N）",
  showSubtitles: "顯示字幕（C）",
  hideSubtitles: "隱藏字幕（C）",
  subtitlesShortcut: "字幕（C）",
  enterFullscreen: "進入全螢幕",
  exitFullscreen: "離開全螢幕",
  enterFullscreenTooltip: "全螢幕（F）",
  exitFullscreenTooltip: "離開全螢幕（F / Esc）",
  settingsShortcut: "設定（Alt+P）",
  closePreview: "關閉預覽",
  descriptionAndComments: "說明與留言",
  mute: "靜音",
  unmute: "取消靜音",
  videoProgress: "影片進度",
  volume: "音量",
  progressOf: (elapsed, total) => `已播放 ${elapsed}，共 ${total}`,
  chaptersLabel: "章節",
  viewChapters: "查看章節",
  closeChapters: "關閉章節",
  chaptersCurrent: title => `章節：${title}`,
  noChapters: "此影片沒有章節。",
  loadingChapters: "正在載入章節…",
  openPreviewForChapters: "請先開啟預覽以查看章節。",
  playlistLabel: "播放清單",
  autoplayNextLabel: "自動播放下一部",
  previewNavigation: "預覽導覽",
  videosInPlaylist: "播放清單中的影片",
  closePlaylist: "關閉播放清單",
  playlistUnavailableRetry: "播放清單無法使用，重試",
  playlistLoading: "播放清單，載入中",
  loadingPlaylist: "正在載入播放清單…",
  playlistPosition: position => `播放清單，${position}`,
  playlistInteractionHint: position => `${position} · 選擇影片`,
  hoverToPrepare: "懸停以準備",
  clickToPlay: "點擊播放",
  preparingPreview: "正在準備預覽…",
  previewReady: "已就緒",
  previewUnavailable: "預覽無法使用",
  previewPlaying: "播放中",
  nativePreviewReadyStartingPlayback: "原生預覽已就緒，正在開始播放…",
  preparingNativePreview: title => `正在為「${title}」準備 YouTube 原生預覽…`,
  preparingPreferredResolution: "正在準備偏好的解析度…",
  settingsRestoredSaveFailed: "已為此頁面還原設定，但無法儲存",
  hideShowControlsShortcut: "隱藏/顯示控制項：Alt+P",
  mutedFeedback: "已靜音",
  startingVideo: "正在啟動影片…",
  retryingPreview: (attempt, total) => `正在重試預覽（${attempt} / ${total}）…`,
  inlinePreviewControlPanel: "站內預覽控制面板",
  controlPanelSections: "控制面板分頁",
  previewUnavailableNoVideo: "預覽無法使用。YouTube 尚未提供影片。請再試一次或關閉預覽。",
  unavailable: "無法使用",
  previewError: message => {
    const exact: Record<string, string> = {
      "The preview stream changed before playback started.": "預覽串流在開始播放前已變更。",
      "The extension could not start preview preparation.": "Playmium 無法開始準備預覽。",
      "The preview stream changed before the selection was ready.": "預覽串流在選取項目準備完成前已變更。",
      "Preview playback is unavailable for this video.": "此影片無法使用預覽播放。",
      "The preview session changed before playback started.": "預覽工作階段在開始播放前已變更。",
      "YouTube did not finish loading the selected preview.": "YouTube 未能完成載入所選預覽。",
      "YouTube's native hover preview timed out. Try again.": "YouTube 原生懸停預覽逾時。請再試一次。",
      "The preview session ended before this item was prepared.": "此項目準備完成前，預覽工作階段已結束。",
      "YouTube's preview renderer did not become ready.": "YouTube 預覽元件未能準備完成。",
      "Preview preparation was cancelled.": "預覽準備已取消。",
    };
    if (exact[message]) return exact[message];
    if (/^YouTube preview .+ timed out\.$/.test(message)) return "YouTube 預覽逾時。";
    if (/^Playlist preview preparation was superseded: .+\.$/.test(message)) return "播放清單預覽準備已被新的要求取代。";
    const quality = /^YouTube did not finish switching to (.+)\.$/.exec(message);
    if (quality) return "YouTube 未能完成切換至 " + quality[1] + "。";
    return message;
  },
  advancedSettings: "進階設定",
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
