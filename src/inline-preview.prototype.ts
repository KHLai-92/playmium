/**
 * THROWAWAY feasibility experiment, not a release feature.
 * Question: can original playlist selections and expanded non-native thumbnails
 * share one complete preview interface that reuses an open extension player or
 * creates one, without tuning stable search/scheduling rules?
 * Real YouTube acceptance is required; the separate TUI only drives fake I/O.
 * Selectors verified on live desktop YouTube on 2026-09-11.
 */
import { qualityLabels, type QualityState } from "./preview-quality";
import { type CaptionState } from "./preview-captions";
import { floatingRect, resizeRect, preferredQuality, type PreviewRect } from "./preview-window";
import { createSelectControls } from "./preview-select";
import { type PreviewMetadata } from "./preview-metadata";
import { createInfoViewer } from "./preview-info-viewer";
import { collectionPlaylistId, isPlaylistId, defaultPlaylistAutoplayEnabled, defaultPlaylistBrokerTimeoutMultipliers,
  defaultPlaylistStageRetryLimit, loadPlaylistAutoplayPreference, loadPlaylistBrokerTimeoutMultipliers,
  loadPlaylistPreviewRetentionCapacity, loadPlaylistStageRetryLimit, nextPlaylistAutoplayVideoId,
  normalizePlaylistBrokerTimeoutSeconds, normalizePlaylistBrokerTimeoutSettings,
  normalizePlaylistPreviewRetentionCapacity, normalizePlaylistStageRetryLimit, playlistAudioChangeEvent, playlistBrokerClickEvent,
  playlistAutoplayPreparation, playlistBrokerTimeoutMultiplierForSeconds,
  playlistBrokerTimeoutSeconds, playlistBrokerTimeoutSecondsRanges, playlistBrokerTimeoutSecondsStep, playlistGeometry,
  playlistPrefetchCancelEvent, playlistPreviewRetentionCapacity as defaultPlaylistPreviewRetentionCapacity,
  playlistPreviewRetentionEvent, playlistSeedFromLinks, playlistWarmEvent, retainPlaylistPreviews,
  savePlaylistAutoplayPreference, savePlaylistBrokerTimeoutMultipliers, savePlaylistPreviewRetentionCapacity,
  savePlaylistStageRetryLimit, type PlaylistBrokerStage, type PlaylistBrokerTimeoutMultipliers,
  type PlaylistPreviewTrigger, type PreviewPlaylist, type PreviewPlaylistSeed } from "./preview-playlist";
import { defaultPreviewStartupAttempts, defaultPreviewStartupTimeoutSeconds, normalizePreviewStartupAttempts,
  normalizePreviewStartupTimeoutSeconds, previewStartupWakeDelaysMs, resolvePreviewStartupWakeTarget } from "./preview-startup";
import { createDomPageBridge } from "./preview-page-bridge";
import { previewPageOperations, type PlaylistPrimePhase, type PlaylistSelectPhase, type PreviewPageOperations } from "./preview-page-operations";
import { createPreviewSession } from "./preview-session";
import { previewAnimationSpec } from "./preview-animation";
import { normalizePreviewPlaybackRate } from "./preview-media-policy";
import { defaultPreviewLogAutoSaveEnabled, emitPreviewDebugLog, installPreviewDiagnosticsSession, loadPreviewLogAutoSavePreference,
  previewDebugLogVersion, previewDebugLoggingEnabled, savePreviewLogAutoSavePreference } from "./preview-debug-log";
import { createPlaylistScrollDiagnostics, type PlaylistScrollSnapshot } from "./preview-scroll-diagnostics";
import { createPlaylistHoverIntent } from "./preview-playlist-hover";
import { defaultPreviewUiLanguage, loadPreviewUiLanguage, normalizePreviewUiLanguage, previewUiCopy, savePreviewUiLanguage,
  type PreviewUiLanguage } from "./preview-ui-language";

import { previewPageSupported, previewPlaybackSupport, resolvePreviewHost, resolvePreviewThumbnail, previewThumbnailSelector } from "./preview-entry";
import { sharedPreviewPrepareEvent, sharedPreviewCancelEvent, sharedPreviewStartEvent, sharedPreviewResultEvent,
  type SharedPreviewResult } from "./preview-playback-experiment-events";
import { playlistPreviewWarmPhaseEvent } from "./preview-playlist";
import { createPreviewSearchPreference, defaultPreviewUrlSearchEnabled, previewSearchModeEvent,
  previewUrlSearchKey } from "./preview-search-preference";

(async () => {
  if (window !== window.top) return;
  let urlSearchEnabled = defaultPreviewUrlSearchEnabled;
  let updateSearchControl = () => {};
  const searchPreference = createPreviewSearchPreference(chrome.storage.local, value => {
    urlSearchEnabled = value;
    window.dispatchEvent(new CustomEvent(previewSearchModeEvent, { detail: JSON.stringify(value) }));
    updateSearchControl();
  });
  const onSearchStorageChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === "local" && previewUrlSearchKey in changes) searchPreference.receive(changes[previewUrlSearchKey].newValue);
  };
  chrome.storage.onChanged.addListener(onSearchStorageChange);
  // Do not start hover/click work using the default while a saved mode loads.
  await searchPreference.ready;
  const diagnosticSession = installPreviewDiagnosticsSession();
  const pageBridge = createDomPageBridge<PreviewPageOperations>(previewPageOperations);
  const previewSession = createPreviewSession({
    browser: {
      activate(intent) {
        if (!(intent.target instanceof Element)) throw new Error("Preview target is unavailable.");
        const existing = session?.host.hasAttribute("data-skip-preview-owned") &&
          !previewPlaybackSupport(intent.target, intent.videoId, location.pathname).native ? session : null;
        if (existing) {
          release("Switching preview.", existing.host);
          existing.video.classList.add(videoClass);
          existing.host.classList.add(hostClass);
          loading = { host: existing.host, floating: existing.floating ?? floatingRect(innerWidth, innerHeight),
            target: intent.target, videoId: intent.videoId, attempt: 1 };
          existing.host.append(panel); document.documentElement.append(backdrop);
          backdrop.hidden = false; backdrop.style.pointerEvents = "none";
        }
        startPreviewRequest(intent.videoId, intent.target);
        tryPendingPin();
        return { phase: "loading", videoId: intent.videoId };
      },
      control(intent) {
        switch (intent.action) {
          case "play": if (!pendingPlaylistSelection) void play(); break;
          case "pause": session?.video.pause(); break;
          case "toggle-mute": toggleMute(); break;
          case "set-muted": setMuted(Boolean(intent.value)); break;
          case "set-volume": setVolume(Number(intent.value)); break;
          case "adjust-volume": adjustVolume(Number(intent.value)); break;
          case "set-speed": setPlaybackSpeed(Number(intent.value)); break;
          case "seek-by": seek(Number(intent.value)); break;
          case "seek-to": seekTo(Number(intent.value)); break;
          case "toggle-fullscreen": toggleFullscreen(); break;
          case "exit-fullscreen": void exitFullscreen(); break;
          case "toggle-captions": toggleCaptions(); break;
          case "select-caption-language": selectCaptionLanguage(String(intent.value ?? "")); break;
          case "select-caption-translation": selectCaptionTranslation(String(intent.value ?? "")); break;
          case "select-quality": selectQuality(String(intent.value ?? "")); break;
          case "toggle-settings": togglePanel(intent.value === "playmium" ? "playmium" : "youtube"); break;
          case "toggle-chapters": toggleChapters(); break;
          case "toggle-info": toggleInfo(); break;
          case "toggle-playlist": setPlaylistExpanded(typeof intent.value === "boolean" ? intent.value : !playlistExpanded, intent.value === false); break;
          case "toggle-playlist-autoplay": togglePlaylistAutoplay(); break;
        }
      },
      playbackPaused() { return session?.video.paused ?? true; },
      playlist(intent, context) {
        if (intent.action === "select" && intent.videoId) activatePlaylistItem(intent.videoId, context.signal, intent.actionId, intent.rect);
      },
      close() { closePreview(); },
      dispose() { release(); },
    },
    present(view) {
      if (session) session.wantsPlayback = view.wantsPlayback;
      panel.dataset.sessionPhase = view.phase;
      panel.dataset.sessionVideoId = view.videoId;
    },
  });
  const prototypeVersion = previewDebugLogVersion;
  const hostClass = "skip-ads-preview-prototype-pinned";
  const ancestorClass = "skip-ads-preview-prototype-ancestor";
  const videoClass = "skip-ads-preview-prototype-video";
  const previewSelector = "ytd-video-preview, #inline-preview-player, #video-preview, [data-skip-preview-owned]";
  const shortsSelector = "ytd-reel-video-renderer,ytd-reel-item-renderer,ytm-shorts-lockup-view-model,ytm-shorts-lockup-view-model-v2,yt-shorts-lockup-view-model,a[href^='/shorts/'],a[href*='youtube.com/shorts/']";
  type AudioVideo = HTMLVideoElement & {
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };
  type StreamRestore = { until: number; videoId: string; time: number; muted: boolean; volume: number; rate: number; changedSource?: boolean; reapplyQuality?: string; preserveTime?: boolean; quality?: string; startup?: boolean };
  type PlaylistContext = { playlistId: string; href: string; seed?: PreviewPlaylistSeed };
  type Session = {
    video: AudioVideo;
    host: HTMLElement;
    videoId: string | null;
    ancestors: HTMLElement[];
    source: string;
    initial: { muted: boolean; volume: number; rate: number };
    events: AbortController;
    previousFocus: HTMLElement | null;
    muteRequest: { value: boolean; ticksLeft: number } | null;
    requestedMuted: boolean | null;
    preservedUnmuteEvents: number;
    fullscreenEntered: boolean;
    fullscreenRequested?: boolean;
    fullscreenPending?: boolean;
    floating?: PreviewRect;
    aspectRatio?: number;
    closing?: boolean;
    animation?: Animation;
    defaultQualityApplied?: boolean;
    startupQualityPending: boolean;
    startupQualityUntil: number;
    wantsPlayback: boolean;
    debugPlaybackStarted: boolean;
    qualityChange?: StreamRestore | null;
    fullscreenRestore?: StreamRestore | null;
    startupRestore?: StreamRestore | null;
    playlistContext?: PlaylistContext;
    previewTarget?: HTMLElement;
    originalWatchHrefs?: Map<HTMLAnchorElement, string>;
  };
  let session: Session | null = null;
  let qualityState: QualityState | null = null;
  let qualityVideo: HTMLVideoElement | null = null;
  let qualityChoice: { owner: Session; value: string; at: number } | null = null;
  let captionState: CaptionState | null = null;
  let captionOwner: Session | null = null;
  let captionChoice: boolean | null = null;
  let captionTrackChoice = "";
  let captionTranslationChoice = "";
  let metadataOwner: Session | null = null;
  let metadata: PreviewMetadata | null = null;
  let chapterSignature = "";
  let metadataRequestSource = "";
  let dragging: { owner: Session; pointerId: number; x: number; y: number; rect: PreviewRect; moved: boolean } | null = null;
  let suppressDragClickUntil = 0;
  let resizing: { owner: Session; pointerId: number; edge: string; x: number; y: number; rect: PreviewRect } | null = null;
  const enabledKey = "skipAds.inlinePreviewPrototype.enabled";
  const playlistPreviewRetentionCapacityKey = "skipAds.inlinePreviewPrototype.playlistPreviewRetentionCapacity";
  const playlistStageRetryLimitKey = "skipAds.inlinePreviewPrototype.playlistStageRetryLimit";
  const playlistBrokerTimeoutMultipliersKey = "skipAds.inlinePreviewPrototype.playlistBrokerTimeoutMultipliers";
  const playlistAutoplayKey = "skipAds.inlinePreviewPrototype.playlistAutoplay";
  const previewStartupTimeoutKey = "skipAds.inlinePreviewPrototype.startupTimeoutSeconds";
  const previewStartupAttemptsKey = "skipAds.inlinePreviewPrototype.startupAttempts";
  const uiLanguageKey = "skipAds.inlinePreviewPrototype.uiLanguage";
  const logAutoSaveKey = "debugLoggingEnabled";
  let enabled = true;
  let playlistPreviewRetentionCapacity = defaultPlaylistPreviewRetentionCapacity;
  let playlistStageRetryLimit = defaultPlaylistStageRetryLimit;
  let playlistBrokerTimeoutMultipliers = normalizePlaylistBrokerTimeoutSettings(defaultPlaylistBrokerTimeoutMultipliers);
  let playlistAutoplay = defaultPlaylistAutoplayEnabled;
  let previewStartupTimeoutSeconds = defaultPreviewStartupTimeoutSeconds;
  let previewStartupAttempts = defaultPreviewStartupAttempts;
  let uiLanguage: PreviewUiLanguage = defaultPreviewUiLanguage;
  let autoSaveLogs = false;
  let pendingPin: { videoId: string; until: number; notBefore: number; attempt: number; owned?: boolean; playlistContext?: PlaylistContext } | null = null;
  let sharedLatency: { videoId: string; mechanism: string; startedAt: number; firstFrameMs?: number; visibleMs?: number } | null = null;
  let sharedUiEvents: AbortController | null = null;
  let loading: { host: HTMLElement; floating: PreviewRect; animation?: Animation; target: Element; videoId: string; attempt: number; playlistContext?: PlaylistContext; owned?: boolean; closing?: boolean } | null = null;
  let lastReleasedPreview: { video: HTMLVideoElement; videoId: string | null; at: number } | null = null;
  let activationMessage = "";
  let nativeAction = false;
  let scrubbing = false;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let volumeFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let speedFeedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let previewStartupWakeTimers: ReturnType<typeof setTimeout>[] = [];
  let playlist: PreviewPlaylist | null = null;
  let playlistError = "";
  let playlistExpanded = false;
  let playlistRevealed = false;
  let sidePanelTab: "chapters" | "playlist" | null = null;
  let playlistSelectionSequence = 0;
  let playlistActionSequence = 0;
  let playlistRequestSequence = 0;
  const playlistPreviewStates = new Map<string, "preparing" | "ready" | "error">();
  const playlistPreviewActions = new Map<string, string>();
  let playlistPrimeIntent: {
    actionId: string; startedAtMs: number; videoId: string; trigger: PlaylistPreviewTrigger; request: Promise<void> | null;
  } | null = null;
  let pendingPlaylistSelection: {
    requestId: string; actionId: string; videoId: string; source: string; previousVideoId: string | null; previousIndex: number;
    previousHrefs: Map<HTMLAnchorElement, string>; committed: boolean;
  } | null = null;
  let playlistSelectionRetry: string | null = null;
  let message = "Press Alt+P for controls. Enable preview mode, then click a video preview.";
  let heard = "Not checked";
  const panel = document.createElement("aside");
  const playlistChrome = document.createElement("aside");
  const backdrop = document.createElement("div");
  backdrop.id = "skip-ads-preview-backdrop";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483645;background:transparent;pointer-events:auto;touch-action:pan-y";
  panel.id = "skip-ads-preview-prototype";
  panel.style.cssText = "position:fixed;right:16px;bottom:16px;width:464px;height:calc(100vh - 32px);z-index:2147483647!important;max-width:calc(100vw - 32px);";
  const shadow = panel.attachShadow({ mode: "open" });
  playlistChrome.id = "skip-ads-preview-playlist";
  playlistChrome.hidden = true;
  playlistChrome.style.cssText = "position:fixed;inset:0;z-index:2147483647!important;pointer-events:none!important;";
  const playlistShadow = playlistChrome.attachShadow({ mode: "open" });
  const panelStyle = document.createElement("style");
  panelStyle.textContent = `
    :host{color-scheme:dark} *{box-sizing:border-box}
    section{width:420px;max-width:calc(100vw - 32px);font:13px/1.4 system-ui;color:#eee;background:#171a20;border:1px solid #64748b;border-radius:12px;padding:14px;box-shadow:0 8px 30px #0008}
    header{display:flex;justify-content:space-between;align-items:center;gap:12px} strong{font-size:14px} p{margin:8px 0}
    button,select,input{font:inherit} button,select{color:#fff;background:#303844;border:1px solid #697586;border-radius:6px;padding:6px 9px;cursor:pointer}
    button:disabled,select:disabled,input:disabled{opacity:.45;cursor:default} button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #5eead4}
    .row{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:8px} label{display:flex;align-items:center;gap:6px}
    input{width:130px} #progress-display{position:fixed;left:20px;right:20px;bottom:12px;padding:10px 12px;background:#000c;border-radius:8px;color:#fff;font:13px/1.4 system-ui;z-index:1} #progress{width:100%;margin:0 0 4px;accent-color:#5eead4} #time{font-variant-numeric:tabular-nums} pre{font:11px/1.4 ui-monospace,monospace;white-space:pre-wrap;max-height:190px;overflow:auto;background:#101318;padding:8px;border-radius:6px}
    small{color:#bcc6d3} [hidden]{display:none!important}
    .enable-row{display:flex;align-items:center;justify-content:space-between;margin:12px 0 4px;gap:12px}
    .preview-toggle{display:inline-flex;align-items:center;padding:3px;border:0;background:transparent;gap:8px}
    .toggle-switch{position:relative;width:44px;height:24px;flex:0 0 44px;border:1px solid #ffffff2b;border-radius:13px;background:#3a4553;transition:background .18s,border-color .18s}
    .toggle-knob{position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#dce5ee;box-shadow:0 1px 4px #0008;transition:transform .2s cubic-bezier(.2,.8,.2,1)}
    .preview-toggle[aria-checked=true] .toggle-switch{background:#22b8c6;border-color:#4dd9e3}
    .preview-toggle[aria-checked=true] .toggle-knob{transform:translateX(20px);background:#fff}
    #enabled-state{min-width:24px;text-align:left;color:#9ca9b8}
    .preview-toggle[aria-checked=true] #enabled-state{color:#67d9e5}
    .sound-control{display:inline-flex;align-items:center;gap:4px;padding:0 12px 0 2px;border-radius:24px;background:#0006}
    #speaker{position:relative;display:grid;place-items:center;width:38px;height:38px;padding:6px;border:0;background:transparent;border-radius:50%;color:#fff}
    #speaker:hover,#speaker:focus-visible{background:#ffffff18}
    #speaker svg{width:26px;height:26px;fill:currentColor}
    #speaker[data-muted=true] .sound-waves,#speaker[data-muted=false] .sound-slash{display:none}
    .sound-tooltip{position:absolute;left:0;bottom:calc(100% + 10px);display:flex;align-items:center;gap:5px;white-space:nowrap;padding:5px 8px;border-radius:5px;background:#292929f5;color:#fff;font:600 13px/1.3 system-ui;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s}
    #speaker:hover .sound-tooltip,#speaker:focus-visible .sound-tooltip{opacity:1;visibility:visible}
    .sound-tooltip kbd{padding:0 3px;border:1px solid #ffffff70;border-radius:3px;font:inherit}
    .sound-control #volume{width:100px;accent-color:#fff}
    @media(prefers-reduced-motion:reduce){.toggle-switch,.toggle-knob{transition-duration:.01ms}}
  `;
  // Build static controls through DOM APIs, including in worlds where YouTube
  // requires TrustedHTML. No policy override or HTML string injection needed.
  function node<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string>, ...children: (Node | string)[]) {
    const result = document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    result.append(...children);
    return result;
  }
  const button = (id: string, text: string, active = true) => node("button", { id, ...(active ? { "data-active": "" } : {}) }, text);
  const row = (...children: Node[]) => node("div", { class: "row" }, ...children);
  const settingsHelp = (id: string, text: string) => node("span", {
    id, class: "settings-help", role: "note", tabindex: "0",
    "aria-label": text, "data-tooltip": text,
  }, "i");
  const settingRow = (label: string, input: Node, output: Node, labelId = "", help = "") => {
    const labelNode = node("span", {
      class: `setting-label${help ? " settings-text-help" : ""}`,
      ...(labelId ? { id: labelId } : {}),
      ...(help ? { tabindex: "0", "aria-description": help, "data-tooltip": help } : {}),
    }, label);
    return row(node("label", {}, labelNode, input, output));
  };
  const settingsChoice = (id: string, label: string, values: readonly number[], selected: number) => node("div", {
    id, class: "settings-choice", role: "group", "aria-label": label,
  }, ...values.map(value => node("button", {
    type: "button", "data-value": String(value), "aria-pressed": String(value === selected),
  }, String(value))));
  const settingsChoiceValue = (control: HTMLElement) => Number(control.querySelector<HTMLButtonElement>("button[aria-pressed=true]")?.dataset.value);
  const applySettingsChoice = (control: HTMLElement, value: number) => {
    for (const button of control.querySelectorAll<HTMLButtonElement>("button[data-value]")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.value) === value));
    }
  };
  function icon(pathData: string, className = "", fill = false) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", className);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData); path.setAttribute("fill", fill ? "currentColor" : "none");
    path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.8");
    path.setAttribute("stroke-linecap", "round"); path.setAttribute("stroke-linejoin", "round");
    svg.append(path); return svg;
  }
  const iconButton = (id: string, label: string, ...children: Node[]) => node("button",
    { id, class: "player-button", "data-active": "", "aria-label": label, "data-tooltip": label }, ...children);
  const playButton = iconButton("play", "Pause (K)", icon("M8 5l11 7-11 7z", "icon-play", true), icon("M7 5h3v14H7z M14 5h3v14h-3z", "icon-pause", true));
  const playlistPreviousButton = iconButton("playlist-previous", "Previous playlist video (Shift+P)",
    icon("M6 5h2v14H6z M19 5v14L9 12z", "", true));
  const playlistNextButton = iconButton("playlist-next", "Next playlist video (Shift+N)",
    icon("M16 5h2v14h-2z M5 5v14l10-7z", "", true));
  playlistPreviousButton.hidden = true;
  playlistPreviousButton.setAttribute("aria-keyshortcuts", "Shift+P");
  playlistNextButton.hidden = true;
  playlistNextButton.setAttribute("aria-keyshortcuts", "Shift+N");
  const captionsButton = iconButton("captions", "Subtitles (C)", icon("M3 5h18v14H3z M10 9H7v6h3 M17 9h-3v6h3"));
  captionsButton.setAttribute("aria-pressed", "false"); captionsButton.setAttribute("aria-keyshortcuts", "C");
  const fullscreenButton = iconButton("fullscreen", "Fullscreen (F)", icon("M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5"));
  fullscreenButton.setAttribute("aria-keyshortcuts", "F");
  const settingsIcon = icon("M10.03 4.66L10.54 1.60L13.46 1.60L13.97 4.66L15.80 5.42L18.32 3.61L20.39 5.68L18.58 8.20L19.34 10.03L22.40 10.54L22.40 13.46L19.34 13.97L18.58 15.80L20.39 18.32L18.32 20.39L15.80 18.58L13.97 19.34L13.46 22.40L10.54 22.40L10.03 19.34L8.20 18.58L5.68 20.39L3.61 18.32L5.42 15.80L4.66 13.97L1.60 13.46L1.60 10.54L4.66 10.03L5.42 8.20L3.61 5.68L5.68 3.61L8.20 5.42Z M15.5 12a3.5 3.5 0 1 0-7 0a3.5 3.5 0 1 0 7 0Z", "icon-settings", true);
  settingsIcon.querySelector("path")!.setAttribute("stroke", "none");
  settingsIcon.querySelector("path")!.setAttribute("fill-rule", "evenodd");
  const settingsButton = iconButton("settings", "Settings (Alt+P)", settingsIcon);
  settingsButton.setAttribute("aria-expanded", "false"); settingsButton.setAttribute("aria-controls", "controls");
  const closeButton = iconButton("release", "Close preview", icon("M6 6l12 12 M18 6 6 18"));
  const chapterButton = iconButton("chapters", "Chapters", node("span", { id: "chapter-title" }, "Chapters"), icon("M9 5l7 7-7 7"));
  chapterButton.hidden = true;
  const infoButton = iconButton("video-info", "Description and comments", icon("M4 4h16v12H9l-5 4V4z M8 8h8 M8 12h5"));
  infoButton.setAttribute("aria-controls", "info-panel"); infoButton.setAttribute("aria-expanded", "false");
  chapterButton.setAttribute("aria-expanded", "false"); chapterButton.setAttribute("aria-controls", "chapter-panel");
  const playlistButton = iconButton("playlist-toggle", "Playlist", icon("M5 6h11 M5 11h11 M5 16h8 M17 14l4 3-4 3z"), node("span", { id: "playlist-position" }, ""));
  playlistButton.hidden = true;
  playlistButton.setAttribute("aria-expanded", "false");
  playlistButton.setAttribute("aria-controls", "skip-ads-preview-playlist-drawer");
  const playlistAutoplayButton = node("button", {
    id: "playlist-autoplay", type: "button", class: "playlist-autoplay-toggle",
    "aria-label": "Autoplay next playlist video: Off"
  },
    node("span", { class: "playlist-autoplay-label" }, "Autoplay next"),
    node("span", { class: "playlist-autoplay-switch", "aria-hidden": "true" },
      node("span", { class: "playlist-autoplay-knob" })));
  playlistAutoplayButton.hidden = true;
  playlistAutoplayButton.setAttribute("aria-pressed", "false");
  const speakerIcon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  speakerIcon.setAttribute("viewBox", "0 0 24 24");
  speakerIcon.setAttribute("aria-hidden", "true");
  for (const [className, d] of [
    ["speaker-body", "M3 9v6h4l5 4V5L7 9H3z"],
    ["sound-waves", "M14 8.2v7.6a4 4 0 0 0 0-7.6z M14 3v2.1a7 7 0 0 1 0 13.8V21a9 9 0 0 0 0-18z"],
    ["sound-slash", "M3.7 2.3 2.3 3.7l18 18 1.4-1.4z"],
  ]) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", className); path.setAttribute("d", d); speakerIcon.append(path);
  }
  const speaker = node("button", { id: "speaker", "data-active": "", "data-muted": "false", "aria-label": "Mute", "aria-keyshortcuts": "M" },
    speakerIcon, node("span", { class: "sound-tooltip", "aria-hidden": "true" }, node("span", { id: "speaker-tip" }, "Mute"), node("kbd", {}, "M")));
  const speed = node("select", { id: "speed", "data-active": "", "aria-label": "Playback speed" },
    ...[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => node("option",
      rate === 1 ? { value: String(rate), selected: "" } : { value: String(rate) }, `${rate}×`)));
  const playlistRetentionInput = node("select", { id: "playlist-retention-capacity", "aria-label": "Previews kept ready",
    "aria-valuetext": `${playlistPreviewRetentionCapacity} saved preview` },
    ...[1, 2, 3].map(capacity => node("option", capacity === playlistPreviewRetentionCapacity
      ? { value: String(capacity), selected: "" } : { value: String(capacity) }, String(capacity))));
  const previewStartupTimeoutInput = node("input", { id: "preview-startup-timeout", type: "range", min: "2", max: "5", step: "0.1",
    value: String(previewStartupTimeoutSeconds), "aria-label": "Attempt timeout", "aria-valuetext": `${previewStartupTimeoutSeconds} seconds` });
  const previewStartupTimeoutValue = node("output", { id: "preview-startup-timeout-value", for: "preview-startup-timeout" }, `${previewStartupTimeoutSeconds} s`);
  const previewStartupAttemptsControl = settingsChoice("preview-startup-attempts", "Max attempts", [1, 2, 3], previewStartupAttempts);
  const previewStartupAttemptsSpacer = node("span", { class: "settings-value-spacer", "aria-hidden": "true" });
  const playlistStageAttemptsControl = settingsChoice("playlist-stage-retry-limit", "Max attempts/step", [1, 2, 3], playlistStageRetryLimit + 1);
  const playlistStageAttemptsSpacer = node("span", { class: "settings-value-spacer", "aria-hidden": "true" });
  const playlistTimeoutInputs = {} as Record<PlaylistBrokerStage, HTMLInputElement>;
  const playlistTimeoutValues = {} as Record<PlaylistBrokerStage, HTMLOutputElement>;
  const playlistTimeoutRow = (stage: PlaylistBrokerStage, label: string, accessibleLabel: string, help: string) => {
    const id = `playlist-${stage}-timeout-seconds`;
    const seconds = playlistBrokerTimeoutSeconds(stage, playlistBrokerTimeoutMultipliers);
    const range = playlistBrokerTimeoutSecondsRanges[stage];
    const input = node("input", { id, type: "range", min: String(range.min), max: String(range.max),
      step: String(playlistBrokerTimeoutSecondsStep), value: String(seconds),
      "aria-label": accessibleLabel, "aria-valuetext": `${seconds} seconds` });
    const output = node("output", { id: `${id}-value`, for: id, class: "playlist-timeout-output" }, `${seconds} s`);
    playlistTimeoutInputs[stage] = input;
    playlistTimeoutValues[stage] = output;
    return settingRow(label, input, output, `playlist-${stage}-timeout-label`, help);
  };
  const uiLanguageSelect = node("select", { id: "ui-language", "aria-label": "Interface language" },
    node("option", { value: "en" }, "English"), node("option", { value: "zh-TW" }, "繁體中文"));
  const logAutoSaveInput = node("input", { id: "auto-save-logs", type: "checkbox", "aria-label": "Auto-save diagnostic logs" });
  const downloadLogButton = node("button", { id: "export", type: "button" },
    icon("M12 3v12 M7 10l5 5 5-5 M5 17v3h14v-3"),
    node("span", { id: "download-current-log-label" }, "Download session log"));
  const videoIdSearchButton = node("button", { id: "video-id-search", type: "button", "aria-pressed": String(!urlSearchEnabled) }, "Video ID");
  const urlSearchButton = node("button", { id: "url-search", type: "button", "aria-pressed": String(urlSearchEnabled) }, "Full URL");
  const searchModeButtons = node("div", { class: "search-mode-buttons", role: "group", "aria-labelledby": "url-search-label" },
    videoIdSearchButton, urlSearchButton);
  const restoreDefaultsButton = node("button", { id: "restore-defaults", type: "button" }, "Reset all settings");
  const youtubeControlsTab = node("button", { id: "youtube-tab", type: "button", role: "tab",
    "aria-selected": "true", "aria-controls": "youtube-panel" }, "YouTube");
  const playmiumTab = node("button", { id: "playmium-tab", type: "button", role: "tab", tabindex: "-1",
    "aria-selected": "false", "aria-controls": "playmium-panel" }, "Playmium");
  shadow.append(panelStyle, node("section", { id: "controls", hidden: "", "aria-label": "Playmium control panel" },
    node("header", {}, node("strong", { id: "control-panel-title" }, "Control panel"), node("button", { id: "collapse", "aria-label": "Close control panel", "aria-expanded": "true", "data-tooltip": "Close control panel" }, "×")),
    node("div", { id: "body" },
      node("div", { id: "control-tabs", role: "tablist", "aria-label": "Control panel tabs" }, youtubeControlsTab, playmiumTab),
      node("div", { id: "progress-display", hidden: "" },
        node("input", { id: "progress", "data-active": "", type: "range", min: "0", max: "1", step: "0.1", value: "0", "aria-label": "Video progress" }),
        node("div", { id: "transport" }, playlistPreviousButton, playButton, playlistNextButton,
          node("div", { class: "sound-control" }, speaker,
            node("input", { id: "volume", "data-active": "", type: "range", min: "0", max: "1", step: "0.05", value: "0.5", "aria-label": "Volume" })),
          node("output", { id: "time", for: "progress", "aria-live": "off" }, "0:00 / --:--"),
          chapterButton,
          node("div", { class: "transport-spacer" }), captionsButton, infoButton, settingsButton, playlistButton, fullscreenButton)),
      node("div", { id: "youtube-panel", role: "tabpanel", "aria-labelledby": "youtube-tab" },
        row(node("label", {}, node("span", { id: "subtitles-label" }, "Subtitles"), node("select", { id: "caption-language", "aria-label": "Subtitle language", disabled: "" }))),
        row(node("label", {}, node("span", { id: "auto-translate-label" }, "Auto-translate"), node("select", { id: "caption-translation", "aria-label": "Subtitle translation", disabled: "" }))),
        node("p", {}, node("small", { id: "caption-status", role: "status" })),
        row(node("label", {}, node("span", { id: "speed-label" }, "Speed"), speed)),
        row(node("label", {}, node("span", { id: "quality-label" }, "Quality"), node("select", { id: "quality", "aria-label": "Video quality", disabled: "" }))),
        node("p", {}, node("small", { id: "quality-status", role: "status" }))),
      node("div", { id: "playmium-panel", role: "tabpanel", "aria-labelledby": "playmium-tab", hidden: "" },
        node("div", { class: "preview-mode-card" }, node("strong", { id: "preview-mode-label" }, "Enable previews"),
          node("button", { id: "enable", class: "preview-toggle", role: "switch", "aria-label": "Enable previews", "aria-checked": "false" },
            node("span", { class: "toggle-switch", "aria-hidden": "true" }, node("span", { class: "toggle-knob" })),
            node("span", { id: "enabled-state", "aria-hidden": "true" }, "Off"))),
        node("div", { class: "language-row" }, node("label", {},
          node("span", { id: "ui-language-label" }, "Interface language"), uiLanguageSelect)),
        node("p", { id: "message", role: "status" }),
        node("div", { class: "settings-group" },
          node("h3", { id: "youtube-native-previews-heading" }, "YouTube native previews"),
          settingRow("Max attempts", previewStartupAttemptsControl, previewStartupAttemptsSpacer, "preview-startup-attempts-label",
            "Limits how many times Playmium tries to start a preview."),
          settingRow("Attempt timeout", previewStartupTimeoutInput, previewStartupTimeoutValue, "preview-startup-timeout-label",
            "Limits how long each attempt may take.")),
        node("div", { class: "settings-group" },
          node("h3", { id: "playmium-added-previews-heading" }, "Playmium-added previews"),
          node("div", { class: "preview-mode-card search-mode-card" },
            node("strong", { id: "url-search-label", class: "settings-text-help", tabindex: "0", "data-tooltip-lines": "2",
              "aria-description": "Chooses how Playmium finds videos for added previews. Full video URL is recommended.",
              "data-tooltip": "Chooses how Playmium finds videos for added previews. Full video URL is recommended." }, "Search method"), searchModeButtons),
          row(node("label", {}, node("span", { class: "setting-label", id: "playlist-retention-label" }, "Previews kept ready"), playlistRetentionInput)),
          settingRow("Max attempts/step", playlistStageAttemptsControl, playlistStageAttemptsSpacer, "playlist-retries-label",
            "Applies this limit to each step below."),
          playlistTimeoutRow("starting", "Search timeout", "Search timeout", "Finds the matching video."),
          playlistTimeoutRow("ready", "Request timeout", "Request timeout", "Starts the preview data request."),
          playlistTimeoutRow("request", "Response timeout", "Response timeout", "Waits for YouTube’s response.")),
        node("div", { class: "restore-row" }, restoreDefaultsButton),
        node("p", { id: "shortcut-help" }, node("small", {}, "Drag the video to move. C subtitles; F fullscreen; Esc leaves fullscreen or closes the floating preview. Click × or outside to close. K / Space play/pause; arrows seek; M mute; Alt+P settings.")),
        row(node("span", { id: "audio-test-label" }, "Audio test:"), button("heard", "Audio works"), button("silent", "No audio")),
        node("p", { id: "audio" }),
        node("details", { id: "troubleshooting" }, node("summary", { id: "troubleshooting-label" }, "Troubleshooting"),
          node("div", { class: "troubleshooting-content" },
            node("small", { id: "troubleshooting-description" }, ""),
            node("label", { class: "troubleshooting-toggle" },
              node("span", { id: "auto-save-logs-label" }, "Auto-save diagnostic logs"),
              logAutoSaveInput),
            node("small", { id: "debug-log-status", role: "status" }, ""),
            downloadLogButton,
            node("small", { id: "download-current-log-help" }, ""),
            node("pre", { id: "state", hidden: "" })))),
    ),
  ));
  // The viewing timeline stays available even when the experiment panel is
  // minimized. Keep it at the bottom of the video, like a normal player.
  shadow.append(shadow.getElementById("progress-display")!);
  shadow.append(node("div", { id: "top-controls", hidden: "" }, closeButton));
  const chapterPanel = node("section", { id: "chapter-panel", hidden: "", "aria-label": "Chapters" },
    node("header", {}, node("strong", { id: "chapter-panel-title" }, "Chapters"), node("button", { id: "close-chapters", "aria-label": "Close chapters" }, "×")),
    node("div", { id: "chapter-list" }));
  shadow.append(chapterPanel);
  const resizeHandles = node("div", { id: "resize-handles", hidden: "", "aria-hidden": "true" },
    ...["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(edge => node("div", { class: "resize-handle", "data-edge": edge })));
  shadow.append(resizeHandles);
  shadow.append(node("div", { id: "volume-feedback", role: "status", "aria-live": "polite", "aria-atomic": "true", "aria-hidden": "true", "data-visible": "false" },
    speakerIcon.cloneNode(true),
    node("div", { class: "volume-feedback-track", "aria-hidden": "true" }, node("span", { id: "volume-feedback-fill" })),
    node("span", { id: "volume-feedback-value" }, "")));
  shadow.append(node("div", { id: "speed-feedback", role: "status", "aria-live": "polite", "aria-atomic": "true", "aria-hidden": "true", "data-visible": "false" },
    node("span", {}, "Speed"), node("strong", { id: "speed-feedback-value" }, "1×")));
  const brandUrl = chrome.runtime.getURL("icons/icon-128.png");
  shadow.append(node("div", { id: "preview-loading", hidden: "" },
      node("img", { src: brandUrl, alt: "", width: "64", height: "64" }),
      node("strong", {}, "Opening preview"),
      node("p", { id: "loading-status", role: "status", "aria-live": "polite" }, "Starting video…"),
      node("div", { id: "loading-pulse", "aria-hidden": "true" }),
      node("button", { id: "loading-retry", hidden: "" }, "Try again")));
  shadow.querySelector("#controls header strong")!.prepend(node("img", { src: brandUrl, alt: "", width: "24", height: "24", class: "preview-brand" }));
  const playerStyle = document.createElement("style");
  playerStyle.textContent = `
    :host{pointer-events:none;container-type:inline-size} section,button,select,input,summary{pointer-events:auto}
    section{position:absolute;right:12px;bottom:72px;width:440px;max-width:calc(100vw - 40px);max-height:calc(100% - 116px);overflow-x:hidden;overflow-y:auto;background:#16191ff5;border:1px solid #ffffff26;border-radius:14px;padding:14px 16px;box-shadow:0 12px 40px #0008;backdrop-filter:blur(18px)}
    header{padding-bottom:10px;border-bottom:1px solid #ffffff14} header strong{font-size:14px} #collapse{background:none;border:0;font-size:22px;padding:0 5px;color:#b7c1ce}
    #control-tabs{display:flex;gap:4px;margin:0 -4px 12px;border-bottom:1px solid #ffffff1c}#control-tabs button{flex:1;border:0;border-radius:0;background:transparent;padding:10px 6px;color:#9eabbc;font-size:11px}#control-tabs button[aria-selected=true]{color:#fff;border-bottom:2px solid #5eead4} [role=tabpanel]{min-width:0}
    .preview-mode-card{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0 4px;padding:10px 12px;border:1px solid #5eead43d;border-radius:10px;background:#5eead40a}.preview-mode-card strong{font-size:13px;font-weight:600}.language-row{margin-top:10px}.language-row label{display:flex;justify-content:space-between;width:100%}.language-row select{width:190px;min-width:0;padding:7px 9px;background:#ffffff0b;border-color:#ffffff1a}.settings-group{border-top:1px solid #ffffff1c;margin-top:12px;padding-top:11px}.settings-group h3,.settings-group h4{margin:0;color:#d9e2ec;font-size:12px;font-weight:650}.settings-group h4{margin-top:13px;color:#9fabb9;font-size:11px}.row{margin-top:10px}.row>label{width:100%;justify-content:space-between;gap:18px}.row select{width:190px;min-width:0;text-overflow:ellipsis;padding:7px 9px;background:#ffffff0b;border-color:#ffffff1a}#playmium-panel .settings-group>.row>label{display:grid;grid-template-columns:minmax(175px,1fr) minmax(75px,1fr) 140px;align-items:center;gap:8px;white-space:nowrap}#playmium-panel .setting-label{min-width:0}#playmium-panel .settings-group input[type=range]{width:100%;min-width:0}#playmium-panel .settings-group output.playlist-timeout-output{display:grid;grid-template-columns:48px 68px;justify-content:end;column-gap:8px;text-align:right;color:#dbe5ef;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}#playmium-panel .timeout-seconds{color:#91a0b3}.restore-row{display:flex;justify-content:flex-end;border-top:1px solid #ffffff1c;margin-top:13px;padding-top:12px}#restore-defaults{background:transparent;border-color:#ffffff2e;color:#d6dee8}#restore-defaults:hover,#restore-defaults:focus-visible{background:#ffffff10;border-color:#ffffff52}#message:empty{display:none}
    #playmium-panel .settings-group>.row>label>output{display:grid;grid-template-columns:48px 68px;justify-content:end;column-gap:8px;text-align:right;color:#dbe5ef;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
    .search-mode-card{background:transparent;border:0;border-radius:0}
    .search-mode-buttons,.settings-choice{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;padding:2px;border:1px solid #414e5d;border-radius:8px;background:#10161d}
    .search-mode-buttons button,.settings-choice button{min-width:0;min-height:28px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:#aeb9c7;font-size:12.5px;white-space:nowrap}
    .search-mode-buttons button[aria-pressed=true],.settings-choice button[aria-pressed=true]{background:#385262;color:#f4fbff;box-shadow:0 0 0 1px #75b9ca inset}
    #controls{width:440px;height:326px}
    #controls:has(#playmium-panel:not([hidden]) #troubleshooting[open]){height:auto;min-height:326px}
    #playmium-main{display:grid;gap:6px}
    #playmium-main>.preview-mode-card{min-height:34px;margin:0;padding:2px 0;border:0;border-radius:0;background:transparent}
    #playmium-main>.language-row,#playmium-main>.row{margin:0}
    #playmium-main>.language-row label,#playmium-main>.row>label{display:grid;grid-template-columns:minmax(0,1fr) 190px;align-items:center;gap:14px;width:100%;white-space:normal}
    #playmium-main .select-trigger{width:100%;min-height:35px;padding-top:6px;padding-bottom:6px}
    #playmium-actions{display:grid;gap:6px;margin-top:1px}
    .panel-nav-button{width:100%;min-height:35px;padding:6px 12px;background:transparent;border-color:#4f829e;color:#dce5ee;text-align:center}
    .panel-nav-button:hover,.panel-nav-button:focus-visible{background:#5eead40a;border-color:#78b9c7}
    #advanced-settings{z-index:7;right:12px;width:min(560px,calc(100% - 24px));max-width:none;min-width:0;padding:0 18px 16px;overflow-x:hidden}
    #advanced-settings-header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px;border-bottom:1px solid #ffffff1c}
    #advanced-settings-header strong{font-size:16px}
    #advanced-settings-title-group{display:flex;align-items:center;gap:9px}
    #advanced-settings-close{display:grid;place-items:center;width:34px;height:34px;padding:0;background:transparent;border:0;color:#aeb9c7;font-size:18px}
    #advanced-settings-close:hover,#advanced-settings-close:focus-visible{background:transparent;border:0;color:#fff;outline:0}
    #advanced-settings>.settings-group{margin-top:14px;padding-top:14px}
    #advanced-settings>.settings-group-first{border-top:0;margin-top:12px;padding-top:0}
    #advanced-settings .search-mode-card{display:grid;grid-template-columns:minmax(220px,1fr) 190px 56px;align-items:center;gap:12px;min-height:39px;margin:7px 0 0;padding:0}
    #advanced-settings .search-mode-buttons{grid-column:2;width:calc(100% - 3px);margin-left:3px}
    #advanced-settings .settings-group h3{display:flex;align-items:center;justify-content:space-between;gap:8px;color:#73aeb0;font-size:13px;font-weight:650}
    #advanced-settings .settings-group>.row{margin-top:11px}
    #advanced-settings .settings-group>.row>label{display:grid;grid-template-columns:minmax(220px,1fr) 190px 56px;align-items:center;gap:12px;width:100%;white-space:nowrap}
    #advanced-settings .setting-label{min-width:0}
    .settings-help{position:relative;z-index:2;display:inline-grid;place-items:center;flex:0 0 19px;width:19px;height:19px;border:1px solid #53718e;border-radius:50%;background:#1b2b3b;color:#9fd4ff;font:700 11px/1 system-ui;cursor:help}
    .settings-help:hover,.settings-help:focus-visible,.settings-help[aria-expanded=true]{border-color:#75d9ff;color:#dff4ff;outline:0;box-shadow:0 0 0 2px #63d5ff2b}
    .settings-text-help{width:max-content;max-width:100%;border-radius:4px;cursor:help;text-decoration:underline dotted transparent;text-underline-offset:4px;transition:color .12s,text-decoration-color .12s,background .12s}
    .settings-text-help:hover,.settings-text-help:focus-visible,.settings-text-help[aria-expanded=true]{color:#eafffb;text-decoration-color:#65d7c8;outline:0;background:#5eead40b}
    #settings-tooltip{position:absolute;z-index:20;width:230px;max-width:calc(100% - 32px);padding:10px 12px;border:1px solid #52677b;border-radius:9px;background:#222c38;color:#eef4fa;box-shadow:0 14px 36px #000b;font:400 12px/1.42 system-ui;white-space:normal;pointer-events:none}
    #settings-tooltip[data-lines="2"]{width:300px;white-space:normal}
    #settings-tooltip::before{content:"";position:absolute;width:9px;height:9px;transform:rotate(45deg);background:#222c38}
    #settings-tooltip[data-side=right]::before{left:-5px;top:var(--arrow-top,18px);border-left:1px solid #52677b;border-bottom:1px solid #52677b}
    #settings-tooltip[data-side=left]::before{right:-5px;top:var(--arrow-top,18px);border-right:1px solid #52677b;border-top:1px solid #52677b}
    #settings-tooltip[data-side=below]::before{top:-5px;left:var(--arrow-left,22px);border-left:1px solid #52677b;border-top:1px solid #52677b}
    #settings-tooltip[data-side=above]::before{bottom:-5px;left:var(--arrow-left,22px);border-right:1px solid #52677b;border-bottom:1px solid #52677b}
    #advanced-settings .settings-group input[type=range]{width:100%;min-width:0}
    #advanced-settings .settings-group output{text-align:right;color:#dbe5ef;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
    #advanced-settings .settings-choice{grid-column:2;width:calc(100% - 3px);margin-left:3px}
    #advanced-settings .settings-value-spacer{grid-column:3}
    #troubleshooting{width:100%;margin:0;padding:0;overflow:hidden;border:1px solid #4f829e;border-radius:10px;color:#aeb9c8;background:#07111b24}
    #troubleshooting summary{display:flex;align-items:center;gap:10px;width:100%;min-height:35px;padding:7px 12px;border:0;background:transparent;color:#c8d2de;font-size:12px;font-weight:500;list-style:none}
    #troubleshooting summary::-webkit-details-marker{display:none}
    #troubleshooting summary::before{content:"";width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:6px solid currentColor;transition:transform .14s}
    #troubleshooting summary:hover,#troubleshooting summary:focus-visible{color:#eef3f9;background:#ffffff0b}
    #troubleshooting[open]{padding:0}
    #troubleshooting[open] summary{border-bottom:1px solid #ffffff1c}
    #troubleshooting[open] summary::before{transform:rotate(90deg)}
    .troubleshooting-content{display:grid;gap:12px;padding:12px;background:#ffffff03}
    #troubleshooting-description,#download-current-log-help,#debug-log-status{display:block;color:#9eabb9;font-size:10.5px;font-weight:450;line-height:1.45}
    .troubleshooting-toggle{display:flex;align-items:center;justify-content:space-between;width:100%;gap:16px;color:#dce5ee}
    .troubleshooting-toggle input[type=checkbox]{appearance:none;width:42px;height:23px;flex:0 0 42px;margin:0;border:1px solid #52657b;border-radius:13px;background:radial-gradient(circle at 11px 50%,#c8d2de 0 7px,transparent 8px),#263547;transition:background .18s,border-color .18s}
    .troubleshooting-toggle input[type=checkbox]:checked{border-color:#4dd9e3;background:radial-gradient(circle at calc(100% - 11px) 50%,#fff 0 7px,transparent 8px),#22b8c6}
    #troubleshooting #debug-log-status{color:#b8c6d4}
    #troubleshooting #export{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;min-height:38px;margin:0;padding:8px 12px;background:#1976bd17;border-color:#3484c1;color:#e4edf6}
    #troubleshooting #export svg{width:18px;height:18px}
    #troubleshooting #export:hover,#troubleshooting #export:focus-visible{background:#1976bd2b;border-color:#55a5e1}
    @container(min-width:1040px){#advanced-settings{right:468px}}
    @container(max-width:620px){#advanced-settings .settings-group>.row>label{grid-template-columns:minmax(0,1fr) 56px;row-gap:6px;white-space:normal}#advanced-settings .setting-label{grid-column:1/-1}#advanced-settings .settings-group input[type=range],#advanced-settings .settings-choice{grid-column:1;width:calc(100% - 3px);margin-left:3px}#advanced-settings .settings-group output{grid-column:2}#advanced-settings .settings-value-spacer{grid-column:2}#advanced-settings .search-mode-card{grid-template-columns:minmax(0,1fr) 56px;row-gap:6px}#advanced-settings .search-mode-card strong{grid-column:1/-1}#advanced-settings .search-mode-buttons{grid-column:1;width:calc(100% - 3px);margin-left:3px}}
    @media(prefers-reduced-motion:reduce){#controls{transition:none}}
    #controls{z-index:6}section{cursor:default;overscroll-behavior:contain}pre{overscroll-behavior:contain}
    #caption-status:empty,#quality-status:empty,#troubleshooting-description:empty,#debug-log-status:empty,#download-current-log-help:empty{display:none} p:has(#caption-status:empty),p:has(#quality-status:empty){display:none} #quality-status{font-size:11px;color:#91a0b3} details{border-top:1px solid #ffffff14;padding-top:10px;margin-top:12px;color:#aeb9c8} details button{font-size:11px} summary{cursor:pointer;font-size:12px}
    #progress-display{position:absolute;inset:auto 0 0;padding:34px 14px 8px;border-radius:0;background:linear-gradient(transparent,#000d);z-index:3;pointer-events:auto}
    #progress{display:block;height:4px;width:100%;margin:0 0 8px;accent-color:#5eead4;cursor:pointer} #transport{display:flex;align-items:center;gap:5px}.transport-spacer{flex:1} #time{font-size:12px;white-space:nowrap;margin:0 6px;color:#f6f7f9}
    .player-button,#speaker{position:relative;display:grid;place-items:center;width:36px;height:36px;padding:7px;border:0;border-radius:50%;background:transparent;color:white;flex-shrink:0;cursor:pointer}
    .player-button:hover,.player-button:focus-visible,#speaker:hover{background:#ffffff22}#playlist-previous:disabled,#playlist-next:disabled{opacity:.45;cursor:default}#playlist-previous:disabled:hover,#playlist-next:disabled:hover{background:transparent}.player-button svg{width:23px;height:23px}.player-button[data-playing=true] .icon-play,.player-button[data-playing=false] .icon-pause{display:none} #captions[aria-pressed=true]::before{content:"";position:absolute;bottom:1px;width:19px;height:2px;border-radius:2px;background:#5eead4}
    .player-button::after{content:attr(data-tooltip);position:absolute;bottom:calc(100% + 10px);right:0;white-space:nowrap;background:#20242df5;border:1px solid #ffffff18;border-radius:6px;padding:5px 8px;font:12px/1.4 system-ui;opacity:0;visibility:hidden;pointer-events:none}.player-button:hover::after,.player-button:focus-visible::after{opacity:1;visibility:visible} #playlist-previous::after,#play::after,#playlist-next::after{left:0;right:auto}#fullscreen::after{right:0;left:auto}
    .sound-control{padding:0;background:transparent;gap:0}.sound-control #volume{width:0;opacity:0;margin:0;transition:width .16s,opacity .16s;accent-color:white}.sound-control:hover #volume,.sound-control:focus-within #volume{width:85px;opacity:1;margin:0 8px 0 2px} #speaker svg{width:24px;height:24px}.sound-tooltip{font-size:12px;font-weight:500}
    #top-controls{position:absolute;top:0;left:0;right:0;display:flex;align-items:center;padding:6px 8px;background:linear-gradient(#0008,transparent);z-index:4;pointer-events:none} #drag-handle{flex:1;color:#ffffffb0;font:22px/32px system-ui;text-align:center;cursor:grab;touch-action:none;user-select:none;pointer-events:auto} #drag-handle:active{cursor:grabbing} #release{background:#151922b3;width:32px;height:32px} #release::after{top:calc(100% + 8px);bottom:auto}
    #top-controls{justify-content:flex-end}
    #chapters{width:auto;max-width:200px;display:flex;gap:4px;border-radius:8px;font:500 12px/1.4 system-ui;padding:5px 8px;min-width:0}#chapter-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#chapters svg{width:16px;height:16px;flex-shrink:0}#chapter-panel{z-index:6;max-height:calc(100% - 96px)}#close-chapters{background:none;border:0;font-size:20px;padding:0 4px}#chapter-list{display:grid;gap:5px;margin-top:10px}.chapter-item{display:grid;grid-template-columns:80px 1fr;gap:10px;text-align:left;padding:7px;background:transparent;border:0;align-items:center}.chapter-item:not(:has(img)){grid-template-columns:1fr}.chapter-item:hover{background:#ffffff14}.chapter-item[aria-current=true]{background:#20443f;color:#83f7df}.chapter-item img{width:80px;aspect-ratio:16/9;object-fit:cover;border-radius:5px}.chapter-copy{display:grid;gap:3px}.chapter-copy small{color:#96c9fa}
    #playlist-toggle{width:auto;min-width:52px;display:flex;gap:5px;padding:5px 8px;border:1px solid #ffffff20;border-radius:9px;background:#ffffff08;font:600 11px/1 system-ui}#playlist-toggle:hover,#playlist-toggle:focus-visible{background:#ffffff18;border-color:#ffffff35}#playlist-toggle[aria-expanded=true]{color:#a9fff0;border-color:#5eead48f;background:#5eead417}#playlist-toggle svg{width:17px;height:17px}#playlist-position{white-space:nowrap;font-variant-numeric:tabular-nums}
    #resize-handles{position:absolute;inset:0;pointer-events:none;z-index:8}.resize-handle{position:absolute;pointer-events:auto;touch-action:none}.resize-handle[data-edge=n],.resize-handle[data-edge=s]{height:7px;left:16px;right:16px;cursor:ns-resize}.resize-handle[data-edge=n]{top:0}.resize-handle[data-edge=s]{bottom:0}.resize-handle[data-edge=e],.resize-handle[data-edge=w]{width:7px;top:16px;bottom:16px;cursor:ew-resize}.resize-handle[data-edge=e]{right:0}.resize-handle[data-edge=w]{left:0}.resize-handle[data-edge=ne],.resize-handle[data-edge=nw],.resize-handle[data-edge=se],.resize-handle[data-edge=sw]{width:16px;height:16px}.resize-handle[data-edge=ne]{top:0;right:0;cursor:nesw-resize}.resize-handle[data-edge=nw]{top:0;left:0;cursor:nwse-resize}.resize-handle[data-edge=se]{bottom:0;right:0;cursor:nwse-resize}.resize-handle[data-edge=sw]{bottom:0;left:0;cursor:nesw-resize}
    #volume-feedback{position:absolute;top:28px;left:50%;transform:translate(-50%,-4px);display:flex;align-items:center;gap:10px;width:260px;max-width:calc(100% - 80px);padding:12px 14px;border:1px solid #ffffff26;border-radius:12px;background:#171e29ed;box-shadow:0 6px 24px #0006;color:#eef3f9;font:600 12px/1.4 system-ui;z-index:5;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .16s,transform .16s,visibility .16s}
    #volume-feedback[data-visible=true]{opacity:1;visibility:visible;transform:translate(-50%,0)}#volume-feedback svg{width:20px;height:20px;fill:currentColor;flex-shrink:0}#volume-feedback[data-muted=true] .sound-waves,#volume-feedback[data-muted=false] .sound-slash{display:none}
    .volume-feedback-track{height:5px;flex:1;min-width:0;border-radius:5px;background:#ffffff30;overflow:hidden}#volume-feedback-fill{display:block;height:100%;width:0;background:#5eead4;border-radius:inherit}#volume-feedback-value{white-space:nowrap;font-variant-numeric:tabular-nums}#volume-feedback[data-muted=true] #volume-feedback-fill{background:#9aa8b8}
    #speed-feedback{position:absolute;top:82px;left:50%;transform:translate(-50%,-5px);display:flex;align-items:center;gap:10px;padding:10px 16px;border:1px solid #ffffff26;border-radius:12px;background:#171e29ed;box-shadow:0 6px 24px #0006;color:#bcc9d9;font:500 12px/1.4 system-ui;z-index:5;pointer-events:none;opacity:0;visibility:hidden;transition:opacity .18s,transform .18s,visibility .18s}
    #speed-feedback[data-visible=true]{opacity:1;visibility:visible;transform:translate(-50%,0)}#speed-feedback-value{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums;color:#5eead4}
    .preview-brand{vertical-align:middle;margin-right:8px}#preview-loading{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:radial-gradient(ellipse at 50% 30%,#213649,#111c2b 65%);color:#eef3f9;font:14px/1.5 system-ui;pointer-events:none}#preview-loading strong{font-size:18px}#preview-loading p{margin:0 24px;text-align:center;color:#a5b8cc;max-width:420px}#loading-retry{pointer-events:auto}#loading-pulse{height:3px;width:110px;border-radius:3px;background:#5eead4;animation:preview-pulse 1.2s ease-in-out infinite} @keyframes preview-pulse{50%{opacity:.25;scale:.55 1}}
    @media(prefers-reduced-motion:reduce){#volume-feedback,#speed-feedback{transition:none}#loading-pulse{animation:none}}
    .row>label{gap:10px;white-space:nowrap}.select-trigger{position:relative;width:190px;min-width:0;text-align:left;padding:8px 28px 8px 10px;border:1px solid #ffffff24;border-radius:8px;background:#242832;color:#eef3f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.select-trigger::after{content:"";position:absolute;right:11px;top:12px;width:6px;height:6px;border-right:1.5px solid #a9b9c9;border-bottom:1.5px solid #a9b9c9;transform:rotate(45deg)}.select-trigger[aria-expanded=true]{border-color:#5eead4;background:#293340}.select-trigger:hover:enabled{background:#2d3440;border-color:#8194a8}.select-trigger:disabled{opacity:.45}
    .select-menu{position:absolute;z-index:20;overflow-y:auto;overscroll-behavior:contain;padding:4px;background:#1d232dfc;color:#eef3f9;border:1px solid #63788c;border-radius:10px;box-shadow:0 12px 32px #0009;pointer-events:auto;font:12px/1.4 system-ui;scrollbar-width:thin;scrollbar-color:#6c7d8e #202631;outline:none}.select-option{position:relative;min-height:36px;padding:9px 29px 9px 10px;border-radius:6px;cursor:pointer;white-space:normal;overflow-wrap:anywhere}.select-option.active{background:#354353}.select-option[aria-selected=true]{color:#74efdc;background:#203d3d}.select-option[aria-selected=true]::after{content:"✓";position:absolute;right:9px;top:9px}.select-option[aria-disabled=true]{opacity:.45;cursor:default}
    @media(max-width:520px){section{right:8px;width:290px;padding:10px;max-width:calc(100vw - 48px)}.row select{width:170px}.player-button,#speaker{width:30px;height:30px;padding:5px}#transport{gap:2px}#time{font-size:10px;margin:0 2px}.sound-control:hover #volume,.sound-control:focus-within #volume{width:50px}}
    @container(max-width:463px){#transport{gap:2px;overflow-x:auto;scrollbar-width:none}.player-button,#speaker{width:28px;height:30px;padding:5px}#time{font-size:10px;margin:0 2px}#chapters{max-width:100px;flex-shrink:1;padding:4px;min-width:20px}#playlist-toggle{min-width:30px;padding:4px}#playlist-position{display:none}#progress-display{padding-left:8px;padding-right:8px}.sound-control:hover #volume,.sound-control:focus-within #volume{width:45px}section{width:calc(100% - 24px);max-width:326px}#controls{height:326px}#controls:has(#playmium-panel:not([hidden]) #troubleshooting[open]){height:auto;min-height:326px}#playmium-panel .settings-group>.row>label{grid-template-columns:minmax(0,1fr) 140px;white-space:normal;row-gap:6px}#playmium-panel .setting-label{grid-column:1/-1}#playmium-panel .settings-group input[type=range]{grid-column:1}#playmium-panel .settings-group output{grid-column:2;font-size:10.5px}#playmium-main>.language-row label,#playmium-main>.row>label{grid-template-columns:minmax(0,1fr) 138px}.language-row select{width:100%;margin-top:0}.preview-mode-card{padding:2px 0}}
  `;
  shadow.append(playerStyle);
  const playlistStyle = document.createElement("style");
  playlistStyle.textContent = `
    :host{color-scheme:dark;font:13px/1.4 system-ui;color:#f2f5f8;pointer-events:none}*{box-sizing:border-box}[hidden]{display:none!important}button{font:inherit;color:inherit}
    #playlist-surface{position:fixed;inset:0;pointer-events:none;--mint:#5eead4;--panel:#12161df7;--line:#ffffff20;--muted:#a9b3c1}
    #playlist-edge-zone{position:fixed;left:var(--handle-left);top:var(--handle-top);width:var(--handle-width);height:var(--handle-height);display:grid;place-items:stretch;opacity:0;visibility:hidden;transform:translateX(12px);transition:opacity .15s ease,transform .2s cubic-bezier(.2,.8,.2,1),visibility .15s;pointer-events:none}
    #playlist-surface:is([data-revealed=true],[data-expanded=true]) #playlist-edge-zone{opacity:1;visibility:visible;transform:none;pointer-events:auto}
    #skip-ads-preview-playlist-drawer{position:fixed;left:var(--drawer-left);top:var(--drawer-top);width:var(--drawer-width);height:var(--drawer-height);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--line);border-left:0;border-radius:0 18px 18px 0;background:#08131aec;box-shadow:0 26px 85px #000c;backdrop-filter:blur(24px);opacity:0;visibility:hidden;transform:translateX(22px);transition:opacity .17s ease,transform .22s cubic-bezier(.2,.8,.2,1),visibility .17s;pointer-events:none}
    #playlist-surface:is([data-expanded=true],[data-revealed=true])[data-active-tab=playlist] #skip-ads-preview-playlist-drawer{opacity:1;visibility:visible;transform:none;pointer-events:auto}
    #playlist-resize-proxy{position:fixed;left:calc(var(--player-right) - 7px);top:var(--player-top);width:7px;height:var(--player-height);z-index:4;display:none;cursor:ew-resize;touch-action:none;pointer-events:auto}
    #playlist-surface[data-edge-covered=true]:is([data-expanded=true],[data-revealed=true]) #playlist-resize-proxy{display:block}
    #playlist-header{display:grid;grid-template-columns:64px minmax(0,1fr) auto 32px;gap:11px;align-items:center;padding:12px;border-bottom:1px solid var(--line);min-height:88px}
    #playlist-cover{position:relative;width:64px;aspect-ratio:1;overflow:hidden;border:1px solid #ffffff31;border-radius:12px;background:linear-gradient(155deg,#28366c,#75669d 52%,#f1763f);box-shadow:0 8px 22px #0007}
    #playlist-cover::before{content:"";position:absolute;width:80%;aspect-ratio:1;left:30%;top:16%;border:1px solid #ffffff52;border-radius:50%}#playlist-copy{min-width:0}#playlist-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}#playlist-meta{display:block;margin-top:4px;color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums}
    .playlist-autoplay-toggle{display:flex;align-items:center;gap:8px;padding:5px 7px;border:0;background:transparent;color:#b8c2cf;white-space:nowrap;cursor:pointer}
    .playlist-autoplay-label{font-size:10px;font-weight:600}
    .playlist-autoplay-switch{position:relative;width:30px;height:16px;border-radius:10px;background:#ffffff2b;transition:background .15s}
    .playlist-autoplay-knob{position:absolute;left:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#d7dde5;transition:transform .15s,background .15s}
    .playlist-autoplay-toggle[aria-pressed=true] .playlist-autoplay-switch{background:#5eead466}
    .playlist-autoplay-toggle[aria-pressed=true] .playlist-autoplay-knob{transform:translateX(14px);background:#5eead4}
    .playlist-autoplay-toggle:hover{color:#eef7f5}
    #playlist-close{width:32px;height:32px;border:0;border-radius:9px;background:transparent;font-size:21px;cursor:pointer}#playlist-close:hover,#playlist-close:focus-visible{background:#ffffff16}button:focus-visible{outline:2px solid var(--mint);outline-offset:2px}
    #playlist-items{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;padding:7px;scrollbar-width:thin;scrollbar-color:#607080 transparent}
    .playlist-loading,.playlist-error{display:grid;place-items:center;min-height:150px;padding:24px;color:var(--muted);text-align:center}.playlist-loading::before{content:"";width:24px;height:24px;margin-bottom:12px;border:2px solid #ffffff28;border-top-color:var(--mint);border-radius:50%;animation:playlist-spin .8s linear infinite}.playlist-error button{margin-top:12px;padding:7px 12px;border:1px solid #ffffff2e;border-radius:8px;background:#ffffff0d;color:#eef3f9;cursor:pointer}.playlist-error button:hover,.playlist-error button:focus-visible{background:#ffffff1b}@keyframes playlist-spin{to{transform:rotate(1turn)}}
    .playlist-item{width:100%;min-height:68px;display:grid;grid-template-columns:22px 82px minmax(0,1fr);gap:9px;align-items:center;padding:7px;border:0;border-radius:10px;background:transparent;text-align:left;cursor:pointer}.playlist-item:hover,.playlist-item:focus-visible{background:#ffffff0d}.playlist-item[aria-current=true]{background:#0d2a2dcc;box-shadow:inset 0 0 0 2px #35d9cfcc,0 0 14px #35d9cf18;border-radius:11px}
    .playlist-number{color:#929ead;font-size:10px;text-align:center;font-variant-numeric:tabular-nums}.playlist-item[aria-current=true] .playlist-number{color:var(--mint)}.playlist-thumb{position:relative;width:82px;aspect-ratio:16/9;overflow:hidden;border-radius:6px;background:#273141}.playlist-thumb img{width:100%;height:100%;display:block;object-fit:cover}.playlist-duration{position:absolute;right:3px;bottom:3px;padding:1px 4px;border-radius:3px;background:#000d;font-size:9px}.playlist-item-copy{min-width:0}.playlist-item-title{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-size:12px;font-weight:600;line-height:1.35}.playlist-channel,.playlist-preview-state{display:block;margin-top:4px;overflow:hidden;color:var(--muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.playlist-preview-state{color:#9aa8b8}.playlist-item[data-preview-state=preparing] .playlist-preview-state{color:#f2c879}.playlist-item[data-preview-state=ready] .playlist-preview-state,.playlist-item[data-preview-state=playing] .playlist-preview-state{color:var(--mint)}.playlist-item[data-preview-state=error] .playlist-preview-state{color:#ff9b9b}
    #chapter-panel{pointer-events:auto;position:fixed;left:var(--drawer-left);top:var(--drawer-top);width:var(--drawer-width);height:var(--drawer-height);display:flex;flex-direction:column;overflow:hidden;padding:0;border:1px solid var(--line);border-left:0;border-radius:0 18px 18px 0;background:#08131aec;box-shadow:0 26px 85px #000c;backdrop-filter:blur(24px);color:#f2f5f8}
    #chapter-panel header{display:flex;align-items:center;justify-content:space-between;min-height:64px;padding:12px 16px;border-bottom:1px solid var(--line)}
    #chapter-panel header strong{font-size:14px}
    #close-chapters{width:32px;height:32px;border:0;border-radius:9px;background:transparent;font-size:21px;cursor:pointer}
    #close-chapters:hover,#close-chapters:focus-visible{background:#ffffff16}
    #chapter-list{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;padding:8px;scrollbar-width:thin;scrollbar-color:#607080 transparent}
    .chapter-item{width:100%;display:grid;grid-template-columns:80px minmax(0,1fr);gap:10px;align-items:center;padding:8px;border:0;border-radius:9px;background:transparent;color:inherit;text-align:left;cursor:pointer}
    .chapter-item:not(:has(img)){grid-template-columns:1fr}.chapter-item:hover{background:#ffffff0d}.chapter-item[aria-current=true]{background:#0d2a2dcc;box-shadow:inset 0 0 0 2px #35d9cfcc,0 0 14px #35d9cf18;border-radius:11px}
    .chapter-item img{width:80px;aspect-ratio:16/9;object-fit:cover;border-radius:6px}.chapter-copy{display:grid;gap:3px;min-width:0}.chapter-copy small{color:#96c9fa}

    #playlist-edge-zone{left:calc(var(--drawer-left) - 64px);top:var(--drawer-top);width:64px;height:var(--drawer-height);display:block;background:#08131aec;border:1px solid var(--line);border-right:0;border-radius:18px 0 0 18px;box-shadow:0 26px 85px #000c;backdrop-filter:blur(24px)}
    #side-panel-tabs{display:flex;flex-direction:column;gap:0;height:100%}
    #playlist-surface[data-revealed=true][data-active-tab=""] #playlist-edge-zone{
      left:calc(var(--drawer-left) + var(--drawer-width) - 64px);
      border-right:1px solid var(--line);
      border-radius:18px
    }
    #side-panel-tabs button{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:64px;min-height:0;flex:1;padding:10px 6px;border:0;border-radius:0;background:transparent;color:#9da8b6;cursor:pointer}
    #side-panel-tabs button:hover{color:#e5f7f3;background:#ffffff0d}#side-panel-tabs button[aria-selected=true]{color:#a9fff0;border-color:#5eead45c;background:#5eead412}#side-panel-tabs button[aria-selected=true]::before{content:"";position:absolute;left:-1px;top:16%;bottom:16%;width:3px;border-radius:3px;background:#5eead4;box-shadow:0 0 10px #5eead466}
    #side-panel-tabs svg{width:22px;height:22px;flex-shrink:0}
    #side-panel-tabs span{font-size:10px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
    @media(prefers-reduced-motion:reduce){#playlist-edge-zone,#skip-ads-preview-playlist-drawer{transition:none}}
  `;

  const chapterSideTab = node("button", {
    id: "side-tab-chapters", type: "button", role: "tab",
    "aria-label": "Chapters", "aria-selected": "false"
  }, icon("M4 4h16v16H4z M9 4v16 M12 8h5 M12 12h5 M12 16h3"), node("span", {}, "Chapters"));

  const playlistSideTab = node("button", {
    id: "side-tab-playlist", type: "button", role: "tab",
    "aria-label": "Playlist", "aria-selected": "false"
  }, icon("M5 6h11 M5 11h11 M5 16h8 M17 14l4 3-4 3z"), node("span", {}, "Playlist"));

  const sidePanelTabs = node("div", {
    id: "side-panel-tabs", role: "tablist", "aria-label": "Preview navigation"
  }, chapterSideTab, playlistSideTab);

  const playlistCover = node("span", { id: "playlist-cover", "aria-hidden": "true" });
  const playlistList = node("div", { id: "playlist-items", role: "list", "aria-label": "Videos in this playlist" });

  function updateSidePanelScrollbars() {
    const chapterList = chapterPanel.querySelector<HTMLElement>("#chapter-list");

    for (const list of [chapterList, playlistList]) {
      if (!list) continue;
      list.style.overflowY = list.scrollHeight > list.clientHeight + 1 ? "auto" : "hidden";
    }
  }
  const playlistHoverIntent = createPlaylistHoverIntent({
    schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  const playlistDrawer = node("section", { id: "skip-ads-preview-playlist-drawer", "aria-label": "Playlist" },
    node("header", { id: "playlist-header" }, playlistCover,
      node("span", { id: "playlist-copy" }, node("strong", { id: "playlist-title" }, "Playlist"), node("small", { id: "playlist-meta" }, "")),
      playlistAutoplayButton,
      node("button", { id: "playlist-close", type: "button", "aria-label": "Close playlist" }, "×")),
    playlistList);
  const playlistResizeProxy = node("div", { id: "playlist-resize-proxy", "aria-hidden": "true" });
  const playlistSurface = node("div", { id: "playlist-surface", "data-expanded": "false", "data-revealed": "false", "data-edge-covered": "false" },
    node("div", { id: "playlist-edge-zone" }, sidePanelTabs),
    chapterPanel, playlistDrawer, playlistResizeProxy);
  playlistShadow.append(playlistStyle, playlistSurface);

  const diagnostics = shadow.getElementById("troubleshooting") as HTMLDetailsElement;
  const audioButtons = shadow.getElementById("heard")!.parentElement!;
  const shortcutHelp = shadow.getElementById("shortcut-help")!;

  const playmiumPanelElement = shadow.getElementById("playmium-panel")!;
  const compactPlaymiumMain = node("div", { id: "playmium-main" });

  const advancedSettingsOpen = node("button", {
    id: "advanced-settings-open", type: "button", class: "panel-nav-button", "aria-expanded": "false", "aria-controls": "advanced-settings"
  },
    node("span", { id: "advanced-settings-label" }, "Advanced settings"));

  const advancedSettingsClose = node("button", {
    id: "advanced-settings-close", type: "button", "aria-label": "Close advanced settings"
  }, String.fromCodePoint(0x00D7));

  const advancedSettingsView = node("section", { id: "advanced-settings", role: "dialog", "aria-labelledby": "advanced-settings-title", hidden: "" });
  const advancedSettingsHelp = settingsHelp("advanced-settings-help", "Adjust with care. Increase timeouts if previews fail.");
  const settingsTooltip = node("div", { id: "settings-tooltip", role: "tooltip", hidden: "" });
  const advancedSettingsHeader = node("div", { id: "advanced-settings-header" },
    node("div", { id: "advanced-settings-title-group" },
      node("strong", { id: "advanced-settings-title" }, "Advanced settings"), advancedSettingsHelp),
    advancedSettingsClose);

  const previewModeCard = shadow.getElementById("preview-mode-label")!.closest<HTMLElement>(".preview-mode-card")!;
  const languageRow = shadow.getElementById("ui-language-label")!.closest<HTMLElement>(".language-row")!;
  const messageNode = shadow.getElementById("message")!;
  const nativePreviewGroup = shadow.getElementById("youtube-native-previews-heading")!.closest<HTMLElement>(".settings-group")!;
  nativePreviewGroup.classList.add("settings-group-first");
  const addedPreviewGroup = shadow.getElementById("playmium-added-previews-heading")!.closest<HTMLElement>(".settings-group")!;
  const playlistRetentionRow = playlistRetentionInput.closest<HTMLElement>(".row")!;
  const restoreRow = restoreDefaultsButton.closest<HTMLElement>(".restore-row")!;

  const hiddenLegacyUi = node("div", { id: "hidden-legacy-ui", hidden: "" });
  hiddenLegacyUi.append(messageNode, shortcutHelp, audioButtons, shadow.getElementById("audio")!);
  shadow.getElementById("state")!.hidden = true;
  const playmiumActions = node("div", { id: "playmium-actions" }, advancedSettingsOpen, diagnostics);

  compactPlaymiumMain.append(
    previewModeCard,
    languageRow,
    playlistRetentionRow,
    playmiumActions,
  );

  advancedSettingsView.append(
    advancedSettingsHeader,
    nativePreviewGroup,
    addedPreviewGroup,
    restoreRow,
    settingsTooltip,
  );

  playmiumPanelElement.replaceChildren(
    compactPlaymiumMain,
    hiddenLegacyUi,
  );
  shadow.append(advancedSettingsView);
  const element = <T extends HTMLElement>(id: string) => shadow.getElementById(id) as T;
  const infoViewer = createInfoViewer(shadow, () => session, seekTo, pageBridge, previewUiCopy(defaultPreviewUiLanguage));
  const selectControls = createSelectControls(shadow, panel);
  let activeSettingsTooltipTarget: HTMLElement | null = null;

  function hideSettingsTooltip() {
    settingsTooltip.hidden = true;
    if (activeSettingsTooltipTarget) activeSettingsTooltipTarget.setAttribute("aria-expanded", "false");
    activeSettingsTooltipTarget = null;
  }

  function showSettingsTooltip(target: HTMLElement) {
    const tooltipText = target.dataset.tooltip;
    if (!tooltipText) return hideSettingsTooltip();
    if (activeSettingsTooltipTarget && activeSettingsTooltipTarget !== target) {
      activeSettingsTooltipTarget.setAttribute("aria-expanded", "false");
    }
    activeSettingsTooltipTarget = target;
    target.setAttribute("aria-expanded", "true");
    const twoLines = target.dataset.tooltipLines === "2";
    settingsTooltip.dataset.lines = twoLines ? "2" : "";
    settingsTooltip.textContent = tooltipText;
    settingsTooltip.hidden = false;
    settingsTooltip.style.left = "0px";
    settingsTooltip.style.top = "0px";
    const panelRect = advancedSettingsView.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = settingsTooltip.getBoundingClientRect();
    const margin = 16;
    const gap = 10;
    const scrollLeft = advancedSettingsView.scrollLeft;
    const scrollTop = advancedSettingsView.scrollTop;
    const roomRight = panelRect.right - targetRect.right - margin;
    const roomLeft = targetRect.left - panelRect.left - margin;
    const centerX = targetRect.left - panelRect.left + scrollLeft + targetRect.width / 2;
    const centerY = targetRect.top - panelRect.top + scrollTop + targetRect.height / 2;
    let side: "right" | "left" | "below" | "above";
    let left: number;
    let top: number;
    if (roomRight >= tooltipRect.width + gap) {
      side = "right";
      left = targetRect.right - panelRect.left + scrollLeft + gap;
      top = centerY - tooltipRect.height / 2;
    } else if (roomLeft >= tooltipRect.width + gap) {
      side = "left";
      left = targetRect.left - panelRect.left + scrollLeft - tooltipRect.width - gap;
      top = centerY - tooltipRect.height / 2;
    } else {
      const below = targetRect.bottom - panelRect.top + scrollTop + gap;
      const above = targetRect.top - panelRect.top + scrollTop - tooltipRect.height - gap;
      side = below + tooltipRect.height <= scrollTop + advancedSettingsView.clientHeight - margin ? "below" : "above";
      left = centerX - tooltipRect.width / 2;
      top = side === "below" ? below : above;
    }
    left = Math.max(scrollLeft + margin, Math.min(left,
      scrollLeft + advancedSettingsView.clientWidth - tooltipRect.width - margin));
    top = Math.max(scrollTop + margin, Math.min(top,
      scrollTop + advancedSettingsView.clientHeight - tooltipRect.height - margin));
    settingsTooltip.dataset.side = side;
    settingsTooltip.style.left = `${left}px`;
    settingsTooltip.style.top = `${top}px`;
    settingsTooltip.style.setProperty("--arrow-left", `${Math.max(12, Math.min(centerX - left - 4, tooltipRect.width - 22))}px`);
    settingsTooltip.style.setProperty("--arrow-top", `${Math.max(10, Math.min(centerY - top - 4, tooltipRect.height - 20))}px`);
  }

  const advancedSettingsTooltipTargets = [
    advancedSettingsHelp,
    element("url-search-label"),
    element("preview-startup-attempts-label"),
    element("preview-startup-timeout-label"),
    element("playlist-retries-label"),
    element("playlist-starting-timeout-label"),
    element("playlist-ready-timeout-label"),
    element("playlist-request-timeout-label"),
    restoreDefaultsButton,
  ];
  for (const target of advancedSettingsTooltipTargets) {
    target.setAttribute("aria-expanded", "false");
    target.addEventListener("mouseenter", () => showSettingsTooltip(target));
    target.addEventListener("mouseleave", () => { if (shadow.activeElement !== target) hideSettingsTooltip(); });
    target.addEventListener("focus", () => showSettingsTooltip(target));
    target.addEventListener("blur", hideSettingsTooltip);
  }
  advancedSettingsView.addEventListener("scroll", hideSettingsTooltip, { passive: true });

  function setAdvancedSettingsOpen(open: boolean, focus = true) {
    hideSettingsTooltip();
    advancedSettingsView.hidden = !open;
    advancedSettingsOpen.setAttribute("aria-expanded", String(open));
    selectControls.close();
    if (focus) (open ? advancedSettingsClose : advancedSettingsOpen).focus({ preventScroll: true });
  }

  advancedSettingsOpen.onclick = () => setAdvancedSettingsOpen(true);
  advancedSettingsClose.onclick = () => setAdvancedSettingsOpen(false);

  new MutationObserver(() => {
    if (element("controls").hidden) {
      setAdvancedSettingsOpen(false, false);
    }
  }).observe(element("controls"), {
    attributes: true,
    attributeFilter: ["hidden"],
  });
  // Keep our controls from reaching YouTube's delegated click/gesture handlers.
  for (const name of ["click", "dblclick", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup"]) {
    shadow.addEventListener(name, event => event.stopPropagation());
    playlistShadow.addEventListener(name, event => event.stopPropagation());
  }
  const playlistElement = <T extends HTMLElement>(id: string) => playlistShadow.getElementById(id) as T;
  function applyUiLanguage(value: unknown) {
    uiLanguage = normalizePreviewUiLanguage(value);
    const copy = previewUiCopy(uiLanguage);
    const applySettingsTooltipCopy = (target: HTMLElement, text: string, useAriaLabel = false) => {
      target.dataset.tooltip = text;
      target.setAttribute(useAriaLabel ? "aria-label" : "aria-description", text);
    };
    panel.lang = uiLanguage;
    infoViewer.applyCopy(copy, uiLanguage);
    element("controls").setAttribute("aria-label", copy.inlinePreviewControlPanel);
    element("control-tabs").setAttribute("aria-label", copy.controlPanelSections);
    element("loading-retry").textContent = copy.tryAgain;
    const chapterSideTabLabel = chapterSideTab.querySelector<HTMLElement>("span");
    if (chapterSideTabLabel) chapterSideTabLabel.textContent = copy.chaptersLabel;
    chapterSideTab.setAttribute("aria-label", copy.chaptersLabel);
    chapterPanel.setAttribute("aria-label", copy.chaptersLabel);
    playlistElement("chapter-panel-title").textContent = copy.chaptersLabel;
    playlistElement("close-chapters").setAttribute("aria-label", copy.closeChapters);

    for (const [control, label] of [
      [playlistPreviousButton, copy.previousPlaylistVideo],
      [playlistNextButton, copy.nextPlaylistVideo],
      [captionsButton, copy.subtitlesShortcut],
      [settingsButton, copy.settingsShortcut],
      [closeButton, copy.closePreview],
      [infoButton, copy.descriptionAndComments],
    ] as const) {
      control.setAttribute("aria-label", label);
      control.dataset.tooltip = label;
    }

    element("progress").setAttribute("aria-label", copy.videoProgress);
    element("volume").setAttribute("aria-label", copy.volume);
    chapterSignature = "";
    const playlistSideTabLabel = playlistSideTab.querySelector<HTMLElement>("span");
    if (playlistSideTabLabel) playlistSideTabLabel.textContent = copy.playlistLabel;
    playlistSideTab.setAttribute("aria-label", copy.playlistLabel);
    sidePanelTabs.setAttribute("aria-label", copy.previewNavigation);
    playlistList.setAttribute("aria-label", copy.videosInPlaylist);
    playlistDrawer.setAttribute("aria-label", copy.playlistLabel);
    playlistElement("playlist-close").setAttribute("aria-label", copy.closePlaylist);
    const autoplayNextLabel = playlistAutoplayButton.querySelector<HTMLElement>(".playlist-autoplay-label");
    if (autoplayNextLabel) autoplayNextLabel.textContent = copy.autoplayNextLabel;
    playlistButton.dataset.tooltip = copy.playlistLabel;
    if (!playlist) {
      playlistElement("playlist-title").textContent = copy.playlistLabel;
      if (!playlistError) playlistElement("playlist-meta").textContent = copy.loadingPlaylist;
      playlistButton.setAttribute("aria-label", playlistError ? copy.playlistUnavailableRetry : copy.playlistLoading);
    } else {
      const position = `${playlist.currentIndex + 1} / ${playlist.items.length}`;
      playlistElement("playlist-meta").textContent = copy.playlistInteractionHint(position);
      playlistButton.setAttribute("aria-label", copy.playlistPosition(position));
    }
    const playlistRetry = playlistList.querySelector<HTMLButtonElement>(".playlist-error button");
    if (playlistRetry) playlistRetry.textContent = copy.tryAgain;
    const playlistLoadingStatus = playlistList.querySelector<HTMLElement>(".playlist-loading");
    if (playlistLoadingStatus) playlistLoadingStatus.textContent = copy.loadingPlaylist;
    for (const row of playlistList.querySelectorAll<HTMLElement>(".playlist-item")) {
      const phase = row.dataset.previewState as "idle" | "preparing" | "ready" | "error" | "playing" | undefined;
      const status = row.querySelector<HTMLElement>(".playlist-preview-state");
      if (phase && status) status.textContent = playlistPreviewLabel(phase);
    }
    uiLanguageSelect.value = uiLanguage;
    element("control-panel-title").textContent = copy.controlPanel;
    element("controls").setAttribute("aria-label", copy.inlinePreviewControlPanel);
    element("control-tabs").setAttribute("aria-label", copy.controlPanelSections);
    element("advanced-settings-label").textContent = copy.advancedSettings;
    element("advanced-settings-title").textContent = copy.advancedSettings;
    applySettingsTooltipCopy(advancedSettingsHelp, copy.advancedSettingsIntro, true);
    element("advanced-settings-close").setAttribute("aria-label", copy.closeAdvancedSettings);
    element("collapse").setAttribute("aria-label", copy.closeControlPanel);
    element("collapse").dataset.tooltip = copy.closeControlPanel;
    youtubeControlsTab.textContent = copy.youtube;
    playmiumTab.textContent = copy.playmium;
    element("preview-mode-label").textContent = copy.inlineVideoPreviews;
    element("enable").setAttribute("aria-label", copy.inlineVideoPreviews);
    element("ui-language-label").textContent = copy.interfaceLanguage;
    uiLanguageSelect.setAttribute("aria-label", copy.interfaceLanguage);
    uiLanguageSelect.options[0].textContent = copy.english;
    uiLanguageSelect.options[1].textContent = copy.traditionalChinese;
    element("youtube-native-previews-heading").textContent = copy.youtubeNativePreviews;
    element("url-search-label").textContent = copy.urlSearchMethod;
    applySettingsTooltipCopy(element("url-search-label"), copy.urlSearchHelp);
    updateSearchControl();
    element("preview-startup-timeout-label").textContent = copy.previewStartupTimeout;
    applySettingsTooltipCopy(element("preview-startup-timeout-label"), copy.previewStartupTimeoutHelp);
    previewStartupTimeoutInput.setAttribute("aria-label", copy.previewStartupTimeout);
    element("preview-startup-attempts-label").textContent = copy.previewStartupAttempts;
    applySettingsTooltipCopy(element("preview-startup-attempts-label"), copy.previewStartupAttemptsHelp);
    previewStartupAttemptsControl.setAttribute("aria-label", copy.previewStartupAttempts);
    element("playmium-added-previews-heading").textContent = copy.playmiumAddedPreviews;
    element("playlist-retention-label").textContent = copy.playlistPreviewsKeptReady;
    playlistRetentionInput.setAttribute("aria-label", copy.playlistPreviewsKeptReady);
    element("playlist-retries-label").textContent = copy.retriesPerLoadingStep;
    applySettingsTooltipCopy(element("playlist-retries-label"), copy.retriesPerLoadingStepHelp);
    playlistStageAttemptsControl.setAttribute("aria-label", copy.retriesPerLoadingStep);
    for (const [stage, label, accessibleLabel, help] of [
      ["starting", copy.preparePreviewTimeout, copy.preparePreviewTimeout, copy.preparePreviewTimeoutHelp],
      ["ready", copy.startPlayerTimeout, copy.startPlayerTimeout, copy.startPlayerTimeoutHelp],
      ["request", copy.loadVideoTimeout, copy.loadVideoTimeout, copy.loadVideoTimeoutHelp],
    ] as const) {
      element(`playlist-${stage}-timeout-label`).textContent = label;
      applySettingsTooltipCopy(element(`playlist-${stage}-timeout-label`), help);
      playlistTimeoutInputs[stage].setAttribute("aria-label", accessibleLabel);
      playlistTimeoutInputs[stage].setAttribute("aria-description", help);
    }
    restoreDefaultsButton.textContent = copy.restoreAllDefaults;
    element("audio-test-label").textContent = copy.audioTest;
    element("heard").textContent = copy.audioWorks;
    element("silent").textContent = copy.noAudio;
    element("troubleshooting-label").textContent = copy.troubleshooting;
    element("troubleshooting-description").textContent = copy.troubleshootingDescription;
    element("auto-save-logs-label").textContent = copy.autoSaveLogs;
    logAutoSaveInput.setAttribute("aria-label", copy.autoSaveLogs);
    element("download-current-log-label").textContent = copy.downloadCurrentLog;
    element("download-current-log-help").textContent = copy.downloadCurrentLogHelp;
    element("subtitles-label").textContent = copy.subtitles;
    element("caption-language").setAttribute("aria-label", copy.subtitleLanguage);
    element("auto-translate-label").textContent = copy.autoTranslate;
    element("caption-translation").setAttribute("aria-label", copy.subtitleTranslation);
    element("speed-label").textContent = copy.speed;
    speed.setAttribute("aria-label", copy.playbackSpeed);
    for (const option of speed.options) {
      const rate = Number(option.value);
      option.textContent = rate === 1 ? copy.normalPlaybackSpeed : `${rate}×`;
    }
    element("quality-label").textContent = copy.quality;
    element("quality").setAttribute("aria-label", copy.videoQuality);
    element("debug-log-status").textContent = autoSaveLogs ? copy.autoSaveLogsOn : copy.autoSaveLogsOff;
    applyPlaylistRetentionCapacity(playlistPreviewRetentionCapacity);
    applyPlaylistStageRetryLimit(playlistStageRetryLimit);
    applyPlaylistBrokerTimeoutMultipliers(playlistBrokerTimeoutMultipliers);
    applyPlaylistAutoplay(playlistAutoplay);
    applyPreviewStartupSettings(previewStartupTimeoutSeconds, previewStartupAttempts);
    render();
  }
  let uiLanguagePreferenceChanged = false;
  uiLanguageSelect.onchange = () => {
    uiLanguagePreferenceChanged = true;
    applyUiLanguage(uiLanguageSelect.value);
    void savePreviewUiLanguage(chrome.storage.local, uiLanguageKey, uiLanguage);
    record(`Interface language set to ${uiLanguage}`);
  };
  void loadPreviewUiLanguage(chrome.storage.local, uiLanguageKey).then(
    value => { if (!uiLanguagePreferenceChanged) applyUiLanguage(value); },
    () => { if (!uiLanguagePreferenceChanged) applyUiLanguage(defaultPreviewUiLanguage); },
  );
  const insidePlaylistChrome = (event: Event) => event.composedPath().includes(playlistChrome);
  let debugSummaryTimer: ReturnType<typeof setTimeout> | undefined;
  let debugPointerSamples = 0;
  let debugPointerX = 0;
  let debugPointerY = 0;
  let debugPointerType = "";
  let playlistPointer: { x: number; y: number; type: string } | null = null;
  let debugScrollSamples = 0;
  let debugScrollArea = "";
  let debugScrollTop = 0;
  let debugScrollHeight = 0;
  let debugScrollClientHeight = 0;
  let lastPlaylistScrollAt = 0;
  let lastPlaylistScrollTop: number | null = null;
  const debugElementName = (target: EventTarget | null) => {
    if (target instanceof Element) {
      const id = target.id ? `#${target.id}` : "";
      const classes = [...target.classList].slice(0, 2).map(name => `.${name}`).join("");
      return `${target.tagName.toLowerCase()}${id}${classes}`;
    }
    return target instanceof ShadowRoot ? "#shadow-root" : target === document ? "document" : target === window ? "window" : "unknown";
  };
  const playlistScrollSnapshot = (): PlaylistScrollSnapshot => ({
    scrollTop: Math.round(playlistList.scrollTop * 10) / 10,
    scrollHeight: playlistList.scrollHeight,
    clientHeight: playlistList.clientHeight,
  });
  const scrollDiagnostics = createPlaylistScrollDiagnostics({
    now: () => performance.now(),
    schedule: (callback, milliseconds) => setTimeout(callback, milliseconds),
    cancel: timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
    onBurst: burst => {
      const listRect = playlistList.getBoundingClientRect();
      const shadowHit = playlistShadow.elementFromPoint(burst.pointer.x, burst.pointer.y);
      const documentHit = document.elementFromPoint(burst.pointer.x, burst.pointer.y);
      const listStyle = getComputedStyle(playlistList);
      const drawerStyle = getComputedStyle(playlistDrawer);
      const surfaceStyle = getComputedStyle(playlistSurface);
      const chromeStyle = getComputedStyle(playlistChrome);
      const detail = {
        ...burst,
        scroller: {
          area: "playlist-items",
          maxScrollTop: Math.max(0, burst.after.scrollHeight - burst.after.clientHeight),
          overflowY: listStyle.overflowY,
          overscrollBehaviorY: listStyle.overscrollBehaviorY,
          pointerEvents: listStyle.pointerEvents,
          rect: { left: Math.round(listRect.left), top: Math.round(listRect.top), width: Math.round(listRect.width), height: Math.round(listRect.height) },
          lastScrollAgeMs: lastPlaylistScrollAt ? Math.round((performance.now() - lastPlaylistScrollAt) * 10) / 10 : null,
        },
        hitTest: {
          insideScroller: burst.pointer.x >= listRect.left && burst.pointer.x <= listRect.right &&
            burst.pointer.y >= listRect.top && burst.pointer.y <= listRect.bottom,
          shadow: debugElementName(shadowHit),
          document: debugElementName(documentHit),
          rowVideoId: shadowHit?.closest<HTMLElement>(".playlist-item")?.dataset.videoId ?? "",
        },
        ui: {
          playlistExpanded,
          playlistRevealed,
          playlistHidden: playlistChrome.hidden,
          drawerPointerEvents: drawerStyle.pointerEvents,
          surfacePointerEvents: surfaceStyle.pointerEvents,
          chromePointerEvents: chromeStyle.pointerEvents,
          settingsOpen: !element("controls").hidden,
          chaptersOpen: !chapterPanel.hidden,
          infoOpen: infoViewer.isOpen(),
          backdropPointerEvents: backdrop.style.pointerEvents,
          pendingSelection: Boolean(pendingPlaylistSelection),
        },
      };
      emitPreviewDebugLog("playlist.scroll-burst", detail);
      if (burst.outcome === "stalled") emitPreviewDebugLog("playlist.scroll-stalled", detail);
    },
  });
  function flushDebugInteractionSummary() {
    if (debugSummaryTimer !== undefined) clearTimeout(debugSummaryTimer);
    debugSummaryTimer = undefined;
    if (!debugPointerSamples && !debugScrollSamples) return;
    const playerRect = session?.host.getBoundingClientRect();
    emitPreviewDebugLog("interaction.summary", {
      pointer: debugPointerSamples ? {
        samples: debugPointerSamples, x: debugPointerX, y: debugPointerY, type: debugPointerType,
        inPlayer: Boolean(playerRect && debugPointerX >= playerRect.left && debugPointerX <= playerRect.right &&
          debugPointerY >= playerRect.top && debugPointerY <= playerRect.bottom),
      } : null,
      overlay: {
        settings: !element("controls").hidden,
        chapters: !chapterPanel.hidden,
        info: infoViewer.isOpen(),
        playlistExpanded,
        playlistRevealed,
        backdropPointerEvents: backdrop.style.pointerEvents,
      },
      scroll: debugScrollSamples ? {
        samples: debugScrollSamples, area: debugScrollArea, scrollTop: Math.round(debugScrollTop),
        scrollHeight: debugScrollHeight, clientHeight: debugScrollClientHeight,
      } : null,
    });
    debugPointerSamples = 0;
    debugScrollSamples = 0;
  }
  function scheduleDebugInteractionSummary() {
    if (!previewDebugLoggingEnabled() || debugSummaryTimer !== undefined) return;
    debugSummaryTimer = setTimeout(flushDebugInteractionSummary, 500);
  }
  window.addEventListener("pointermove", event => {
    playlistPointer = { x: event.clientX, y: event.clientY, type: event.pointerType };
    if (!previewDebugLoggingEnabled() || !session?.playlistContext) return;
    debugPointerSamples++;
    debugPointerX = event.clientX;
    debugPointerY = event.clientY;
    debugPointerType = event.pointerType;
    scheduleDebugInteractionSummary();
  }, { capture: true, passive: true });
  const recoverPlaylistHoverAfterActivity = () => playlistHoverIntent.settleAfterActivity(() => {
    if (!retainPlaylistPreviews) return null;
    if (!playlistExpanded || !session?.playlistContext || !playlistPointer || playlistPointer.type === "touch") return null;
    const { x, y } = playlistPointer;
    const listRect = playlistList.getBoundingClientRect();
    if (x < listRect.left || x > listRect.right || y < listRect.top || y > listRect.bottom) return null;
    const row = playlistShadow.elementFromPoint(x, y)?.closest<HTMLElement>(".playlist-item");
    const videoId = row?.dataset.videoId;
    if (!row || !videoId || !row.isConnected || !playlistList.contains(row)) return null;
    return {
      videoId,
      action: () => {
        const rect = row.getBoundingClientRect();
        primePlaylistItem(videoId, { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, "hover");
      },
    };
  });
  window.addEventListener("scroll", event => {
    if (!previewDebugLoggingEnabled() || !session?.playlistContext) return;
    const target = event.target === document ? document.scrollingElement : event.target;
    if (!(target instanceof Element)) return;
    debugScrollSamples++;
    debugScrollArea = target === playlistList ? "playlist-items" : target.id || target.tagName.toLowerCase();
    debugScrollTop = target.scrollTop;
    debugScrollHeight = target.scrollHeight;
    debugScrollClientHeight = target.clientHeight;
    scheduleDebugInteractionSummary();
  }, { capture: true, passive: true });
  playlistList.addEventListener("scroll", () => {
    recoverPlaylistHoverAfterActivity();
    if (!previewDebugLoggingEnabled() || !session?.playlistContext) return;
    const snapshot = playlistScrollSnapshot();
    lastPlaylistScrollAt = performance.now();
    lastPlaylistScrollTop = snapshot.scrollTop;
    debugScrollSamples++;
    debugScrollArea = "playlist-items";
    debugScrollTop = snapshot.scrollTop;
    debugScrollHeight = snapshot.scrollHeight;
    debugScrollClientHeight = snapshot.clientHeight;
    scrollDiagnostics.scroll(snapshot);
    scheduleDebugInteractionSummary();
  }, { passive: true });
  playlistList.addEventListener("wheel", recoverPlaylistHoverAfterActivity, { capture: true, passive: true });
  window.addEventListener("wheel", event => {
    if (!previewDebugLoggingEnabled() || !session?.playlistContext || playlistChrome.hidden) return;
    const rect = playlistList.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    const observed = playlistScrollSnapshot();
    const scrollAgeMs = lastPlaylistScrollAt ? performance.now() - lastPlaylistScrollAt : Number.POSITIVE_INFINITY;
    const compositorMovedFirst = lastPlaylistScrollTop !== null && Math.abs(observed.scrollTop - lastPlaylistScrollTop) >= 1;
    const before = compositorMovedFirst ? { ...observed, scrollTop: lastPlaylistScrollTop! } : observed;
    scrollDiagnostics.wheel({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      target: debugElementName(event.target),
      path: event.composedPath().slice(0, 8).map(debugElementName),
      isTrusted: event.isTrusted,
      observedScrollBeforeDispatch: compositorMovedFirst ? {
        from: lastPlaylistScrollTop!, to: observed.scrollTop, ageMs: Math.round(scrollAgeMs * 10) / 10,
      } : undefined,
    }, before);
    if (compositorMovedFirst) scrollDiagnostics.scroll(observed);
    queueMicrotask(() => scrollDiagnostics.noteDisposition(event.defaultPrevented, event.cancelBubble));
  }, { capture: true, passive: true });
  const sourceCardSelector = "ytd-video-renderer,ytd-radio-renderer,ytd-playlist-renderer,ytd-rich-item-renderer,yt-lockup-view-model";
  const collectionMarkerSelector = "yt-collection-thumbnail-view-model,ytd-playlist-thumbnail";
  function collectionContextFor(target: Element): PlaylistContext | undefined {
    const card = target.closest<HTMLElement>(sourceCardSelector);
    const anchor = target.closest<HTMLAnchorElement>("a[href*='/playlist?']") ??
      card?.querySelector<HTMLAnchorElement>("a[href*='/playlist?']");
    if (!anchor) return;

    try {
      const url = new URL(anchor.href, location.href);
      const playlistId = url.searchParams.get("list");
      if (url.origin !== location.origin || url.pathname !== "/playlist" ||
          !playlistId || !isPlaylistId(playlistId)) return;
      return { playlistId, href: url.href };
    } catch { return; }
  }
  function playlistContextFor(target: Element, videoId: string): PlaylistContext | undefined {
    const preview = target.closest(previewSelector);
    const selectedHref = target.closest<HTMLAnchorElement>("a[href*='/watch?']")?.href ?? preview?.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href;
    if (!selectedHref) {
      const collection = collectionContextFor(target);
      if (collection) return collection;
    }
    const selectedList = selectedHref ? new URL(selectedHref, location.href).searchParams.get("list") : null;
    const directCard = target.closest<HTMLElement>(sourceCardSelector);
    const previewRect = preview?.getBoundingClientRect();
    const cards = directCard ? [directCard] : [...document.querySelectorAll<HTMLElement>(sourceCardSelector)].filter(card => {
      if (!previewRect?.width || !previewRect.height) return false;
      const thumbnail = card.querySelector<HTMLElement>("ytd-thumbnail,yt-thumbnail-view-model") ?? card;
      const rect = thumbnail.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.left < previewRect.right && rect.right > previewRect.left &&
        rect.top < previewRect.bottom && rect.bottom > previewRect.top;
    });
    for (const card of cards) {
      if (card.matches(shortsSelector) || card.querySelector(shortsSelector)) continue;
      const anchor = [...card.querySelectorAll<HTMLAnchorElement>("a[href*='/watch?']")].find(item => {
        const url = new URL(item.href, location.href);
        return url.searchParams.get("v") === videoId && (!selectedList || url.searchParams.get("list") === selectedList) && url.searchParams.has("list");
      });
      if (!anchor) continue;
      const isCollection = card.matches("ytd-radio-renderer,ytd-playlist-renderer") || Boolean(card.querySelector(collectionMarkerSelector));
      const playlistId = collectionPlaylistId(anchor.href, isCollection, location.href);
      if (playlistId) {
        const seed = playlistSeedFromLinks(
          card.querySelector<HTMLElement>("h3,yt-lockup-metadata-view-model")?.textContent ?? "Playlist",
          [...card.querySelectorAll<HTMLAnchorElement>("a[href*='/watch?']")].map(item => ({
            href: item.href,
            label: item.getAttribute("aria-label") ?? item.textContent ?? "",
            thumbnail: item.querySelector<HTMLImageElement>("img")?.currentSrc ?? card.querySelector<HTMLImageElement>("img")?.currentSrc ?? "",
          })),
          videoId, playlistId, location.href,
        ) ?? undefined;
        return { playlistId, href: anchor.href, seed };
      }
    }
  }
  function renderPlaylist() {
    playlistHoverIntent.cancel();
    const eligible = Boolean(session?.playlistContext);
    const available = Boolean(eligible && playlist && playlist.items.length > 1);
    playlistChrome.hidden = chapterButton.hidden && !eligible;
    playlistButton.hidden = !eligible;
    playlistSideTab.hidden = !eligible;
    playlistAutoplayButton.hidden = !eligible;
    playlistPreviousButton.hidden = !eligible;
    playlistNextButton.hidden = !eligible;
    playlistPreviousButton.disabled = !available || !playlist || playlist.currentIndex <= 0;
    playlistNextButton.disabled = !available || !playlist || playlist.currentIndex >= playlist.items.length - 1;
    playlistPreviousButton.dataset.tooltip = previewUiCopy(uiLanguage).previousPlaylistVideo;
    playlistNextButton.dataset.tooltip = previewUiCopy(uiLanguage).nextPlaylistVideo;
    playlistAutoplayButton.setAttribute("aria-pressed", String(playlistAutoplay));
    const autoplayLabel = previewUiCopy(uiLanguage).autoplayNext(playlistAutoplay);
    playlistAutoplayButton.setAttribute("aria-label", autoplayLabel);
    playlistAutoplayButton.dataset.tooltip = autoplayLabel;
    if (!eligible) {
      playlistExpanded = false;
      playlistRevealed = false;
      playlistList.removeAttribute("aria-busy");
      playlistList.replaceChildren();
      return;
    }
    playlistButton.setAttribute("aria-expanded", String(playlistExpanded));
    playlistSurface.dataset.expanded = String(playlistExpanded);
    playlistSurface.dataset.revealed = String(playlistRevealed);
    if (!available || !playlist) {
      playlistList.setAttribute("aria-busy", String(!playlistError));
      element("playlist-position").textContent = "";
      playlistElement("playlist-title").textContent = previewUiCopy(uiLanguage).playlistLabel;
      playlistElement("playlist-meta").textContent = playlistError || previewUiCopy(uiLanguage).loadingPlaylist;
      playlistButton.setAttribute("aria-label", playlistError ? previewUiCopy(uiLanguage).playlistUnavailableRetry : previewUiCopy(uiLanguage).playlistLoading);
      if (playlistError) {
        const retry = node("button", { type: "button" }, previewUiCopy(uiLanguage).tryAgain);
        retry.onclick = () => refreshPlaylist();
        playlistList.replaceChildren(node("div", { class: "playlist-error", role: "status" }, node("span", {}, playlistError), retry));
      } else {
        playlistList.replaceChildren(node("div", { class: "playlist-loading", role: "status" }, previewUiCopy(uiLanguage).loadingPlaylist));
      }
      return;
    }
    playlistList.setAttribute("aria-busy", "false");
    const position = `${playlist.currentIndex + 1} / ${playlist.items.length}`;
    element("playlist-position").textContent = position;
    playlistElement("playlist-title").textContent = playlist.title;
    playlistElement("playlist-meta").textContent = playlistInteractionHint(position);
    playlistButton.setAttribute("aria-label", previewUiCopy(uiLanguage).playlistPosition(position));
    const rows = playlist.items.map((item, index) => {
      const number = node("span", { class: "playlist-number" }, index === playlist!.currentIndex ? "▶" : String(index + 1));
      const thumb = node("span", { class: "playlist-thumb" });
      if (item.thumbnail) thumb.append(node("img", { src: item.thumbnail, alt: "", loading: "lazy", referrerpolicy: "no-referrer" }));
      if (item.duration) thumb.append(node("small", { class: "playlist-duration" }, item.duration));
      const previewStatus = index === playlist!.currentIndex ? "playing" : playlistPreviewStates.get(item.videoId) ?? "idle";
      const previewState = playlistPreviewLabel(previewStatus);
      const row = node("button", { class: "playlist-item", type: "button", role: "listitem", "data-video-id": item.videoId,
        "data-preview-state": previewStatus,
        "aria-current": String(index === playlist!.currentIndex), "aria-label": `${index + 1}. ${item.title}` },
        number, thumb, node("span", { class: "playlist-item-copy" }, node("strong", { class: "playlist-item-title" }, item.title),
          node("small", { class: "playlist-channel" }, item.channel), node("small", { class: "playlist-preview-state", role: "status" }, previewState)));
      const prefetch = (trigger: PlaylistPreviewTrigger) => {
        const rect = row.getBoundingClientRect();
        const bounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        return { actionId: primePlaylistItem(item.videoId, bounds, trigger), rect: bounds };
      };
      row.onclick = event => {
        playlistHoverIntent.cancel();
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        const selection = prefetch("click");
        emitPreviewDebugLog("preview.click", { surface: "playlist", videoId: item.videoId, actionId: selection.actionId });
        queueMicrotask(() => previewSession.dispatch({ type: "playlist", action: "select", videoId: item.videoId,
          actionId: selection.actionId ?? undefined, rect: selection.rect }));
      };
      row.onpointerenter = () => {
        emitPreviewDebugLog("preview.hover", { surface: "playlist", videoId: item.videoId });
        if (!retainPlaylistPreviews) return;
        playlistHoverIntent.enter(item.videoId, () => {
          if ((playlistExpanded || (playlistRevealed && sidePanelTab === "playlist")) && row.isConnected && row.matches(":hover")) prefetch("hover");
        });
      };
      row.onpointerleave = () => {
        playlistHoverIntent.leave(item.videoId);
        cancelPlaylistPrime("pointer-left", item.videoId, "hover");
      };
      row.onfocus = () => { if (retainPlaylistPreviews) prefetch("focus"); };
      row.onblur = () => cancelPlaylistPrime("focus-left", item.videoId, "focus");
      return row;
    });
    playlistList.replaceChildren(...rows);
    requestAnimationFrame(updateSidePanelScrollbars);
    queueMicrotask(() => playlistList.querySelector<HTMLElement>("[aria-current=true]")?.scrollIntoView({ block: "nearest" }));
  }
  function cancelPlaylistPrime(reason: string, videoId?: string, trigger?: PlaylistPreviewTrigger) {
    const intent = playlistPrimeIntent;
    if (!intent || videoId !== undefined && intent.videoId !== videoId || trigger !== undefined && intent.trigger !== trigger) return false;
    const active = session;
    playlistPrimeIntent = null;
    updatePlaylistPreviewPhase({ actionId: intent.actionId, trigger: intent.trigger, videoId: intent.videoId, phase: "idle" });
    emitPreviewDebugLog("preview.prepare-cancel", { surface: "playlist", layer: "ui", actionId: intent.actionId,
      trigger: intent.trigger, videoId: intent.videoId, reason });
    if (active?.playlistContext) active.video.dispatchEvent(new CustomEvent(playlistPrefetchCancelEvent, { bubbles: true, detail: JSON.stringify({
      actionId: intent.actionId, videoId: intent.videoId, playlistId: active.playlistContext.playlistId, reason,
    }) }));
    return true;
  }
  function cancelReadyPlaylistResponses(reason: string) {
    const active = session;
    if (!active?.playlistContext) {
      playlistPreviewActions.clear();
      playlistPreviewStates.clear();
      return;
    }
    for (const [videoId, actionId] of [...playlistPreviewActions]) {
      if (playlistPreviewStates.get(videoId) !== "ready") continue;
      active.video.dispatchEvent(new CustomEvent(playlistPrefetchCancelEvent, { bubbles: true, detail: JSON.stringify({
        actionId, videoId, playlistId: active.playlistContext.playlistId, reason,
      }) }));
      playlistPreviewActions.delete(videoId);
      playlistPreviewStates.delete(videoId);
    }
  }
  function primePlaylistItem(videoId: string, rect: { left: number; top: number; width: number; height: number },
      trigger: PlaylistPreviewTrigger): string | null {
    const active = session;
    if (!active?.playlistContext) return null;
    const readyActionId = playlistPreviewStates.get(videoId) === "ready" ? playlistPreviewActions.get(videoId) : undefined;
    if (readyActionId) {
      if (trigger === "click") cancelPlaylistPrime("ready-click", undefined, undefined);
      return readyActionId;
    }
    const current = playlistPrimeIntent;
    if (current?.videoId === videoId) {
      if (trigger === "click" && current.trigger !== "click") {
        emitPreviewDebugLog("preview.prepare-prioritize", { surface: "playlist", layer: "ui", actionId: current.actionId,
          videoId, from: current.trigger, to: "click" });
        current.trigger = "click";
      }
      return current.actionId;
    }
    cancelPlaylistPrime(`superseded-by-${trigger}`);
    const startedAtMs = performance.now();
    const actionId = `playlist-${++playlistActionSequence}-${Math.round(startedAtMs)}`;
    const intent = { actionId, startedAtMs, videoId, trigger, request: null as Promise<void> | null };
    playlistPrimeIntent = intent;
    playlistPreviewActions.set(videoId, actionId);
    const applyPhase = (detail: PlaylistPrimePhase) => {
      if (session !== active || playlistPreviewActions.get(videoId) !== actionId) return;
      updatePlaylistPreviewPhase(detail);
      if (detail.phase === "ready" && playlistPrimeIntent === intent) playlistPrimeIntent = null;
      if (detail.phase === "idle" || detail.phase === "error") {
        playlistPreviewActions.delete(videoId);
        if (playlistPrimeIntent === intent) playlistPrimeIntent = null;
      }
    };
    emitPreviewDebugLog("preview.prepare-intent", { surface: "playlist", layer: "ui", actionId, trigger, videoId });
    applyPhase({ actionId, trigger, videoId, phase: "preparing" });
    const request = pageBridge.request(active.video, "playlist-prime", {
      actionId, startedAtMs, trigger, videoId, playlistId: active.playlistContext.playlistId,
      retentionCapacity: playlistPreviewRetentionCapacity, retryLimit: playlistStageRetryLimit,
      timeoutMultipliers: playlistBrokerTimeoutMultipliers, rect,
    }, { signal: active.events.signal, onProgress: applyPhase }).then(applyPhase, () => {
      if (session === active && playlistPreviewActions.get(videoId) === actionId) {
        applyPhase({ actionId, trigger, videoId, phase: "idle" });
      }
    });
    intent.request = request;
    return actionId;
  }
  function updatePlaylistPreviewPhase(detail: PlaylistPrimePhase) {
    const phase = detail.phase;
    const previous = playlistPreviewStates.get(detail.videoId) ?? "idle";
    if (phase === "idle") playlistPreviewStates.delete(detail.videoId);
    else playlistPreviewStates.set(detail.videoId, phase);
    if (phase !== previous && (phase === "preparing" || phase === "ready")) {
      emitPreviewDebugLog(`preview.${phase}`, { surface: "playlist", layer: "ui", actionId: detail.actionId,
        trigger: detail.trigger, videoId: detail.videoId });
    }
    if (phase !== previous) {
      emitPreviewDebugLog("preview.prepare-phase", { surface: "playlist", layer: "ui", actionId: detail.actionId,
        trigger: detail.trigger, videoId: detail.videoId, previous, phase });
    }
    const row = playlistList.querySelector<HTMLElement>(`.playlist-item[data-video-id="${CSS.escape(detail.videoId)}"]`);
    if (row && row.getAttribute("aria-current") !== "true") {
      row.dataset.previewState = phase;
      const status = row.querySelector<HTMLElement>(".playlist-preview-state");
      if (status) status.textContent = playlistPreviewLabel(phase);
    }
  }
  document.addEventListener(playlistBrokerClickEvent, event => {
    if (!session || event.target !== session.video) return;
    let detail: { actionId?: unknown; videoId?: unknown };
    try { detail = JSON.parse((event as CustomEvent<string>).detail); } catch { return; }
    if (typeof detail.videoId === "string") {
      const row = playlistList.querySelector<HTMLElement>(`.playlist-item[data-video-id="${CSS.escape(detail.videoId)}"]`);
      const rect = row?.getBoundingClientRect() ?? session.host.getBoundingClientRect();
      previewSession.dispatch({ type: "playlist", action: "select", videoId: detail.videoId,
        actionId: typeof detail.actionId === "string" ? detail.actionId : undefined,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } });
    }
  }, true);
  function refreshPlaylist() {
    const active = session;
    const requestSequence = ++playlistRequestSequence;
    playlist = null;
    playlistError = "";
    renderPlaylist();
    if (!active?.videoId || !active.playlistContext) return;
    syncPlaylistLayout();
    const source = active.video.currentSrc;
    void pageBridge.request(active.video, "playlist-load", {
      source, videoId: active.videoId, playlistId: active.playlistContext.playlistId, seed: active.playlistContext.seed,
    }, { signal: active.events.signal }).then((result: PreviewPlaylist) => {
      if (requestSequence !== playlistRequestSequence) return;
      if (session !== active) return;
      try {
        if (result.source !== source || result.source !== active.video.currentSrc || result.videoId !== active.videoId ||
            result.playlistId !== active.playlistContext?.playlistId) return;
        if (result.error) {
          playlistError = result.error.slice(0, 240);
          renderPlaylist();
          syncPlaylistLayout();
          record("Could not load native collection playlist");
          return;
        }
        if (!Array.isArray(result.items) || result.items.length < 2 ||
            !result.items.every(item => /^[\w-]{11}$/.test(item.videoId) && typeof item.title === "string" && item.title.length <= 300)) return;
        playlist = result;
        playlistError = "";
        renderPlaylist();
        syncPlaylistLayout();
        record("Loaded native collection playlist");
      } catch { /* Ignore invalid native playlist responses. */ }
    }, () => {});
  }
  function playlistInteractionHint(position: string) {
    return previewUiCopy(uiLanguage).playlistInteractionHint(position);
  }
  function playlistPreviewLabel(state: "idle" | "preparing" | "ready" | "error" | "playing") {
    const copy = previewUiCopy(uiLanguage);
    return {
      idle: retainPlaylistPreviews ? copy.hoverToPrepare : copy.clickToPlay,
      preparing: copy.preparingPreview,
      ready: copy.previewReady,
      error: copy.previewUnavailable,
      playing: copy.previewPlaying,
    }[state];
  }
  function handlePlaylistSelectPhase(detail: PlaylistSelectPhase) {
    const active = session;
    const pending = pendingPlaylistSelection;
    if (!active || !playlist || !pending) return;
    if (detail.phase === "commit") {
      if (active.video.currentSrc !== pending.source) return;
      pending.committed = true;
      active.videoId = pending.videoId;
      playlist.currentIndex = playlist.items.findIndex(item => item.videoId === pending.videoId);
      active.qualityChange = { until: performance.now() + 15000, videoId: pending.videoId, time: 0,
        muted: active.video.muted, volume: active.video.volume, rate: active.video.playbackRate, preserveTime: false };
      active.originalWatchHrefs ??= new Map();
      for (const anchor of pending.previousHrefs.keys()) {
        if (!active.originalWatchHrefs.has(anchor)) active.originalWatchHrefs.set(anchor, anchor.href);
        const href = new URL(anchor.href, location.href);
        href.searchParams.set("v", pending.videoId);
        href.searchParams.set("list", active.playlistContext!.playlistId);
        anchor.href = href.href;
      }
      active.video.dataset.skipPreviewPlaylistRequest = pending.requestId;
      emitPreviewDebugLog("preview.select-phase", { surface: "playlist", layer: "ui", actionId: pending.actionId,
        selectionRequestId: pending.requestId, videoId: pending.videoId, phase: "commit" });
      renderPlaylist();
      element("loading-status").textContent = previewUiCopy(uiLanguage).nativePreviewReadyStartingPlayback;
      record("Prepared the selected inline playlist preview");
      return;
    }
    if (detail.phase === "success") {
      if (active.video.dataset.skipPreviewPlaylistRequest === pending.requestId) delete active.video.dataset.skipPreviewPlaylistRequest;
      pendingPlaylistSelection = null;
      playlistSelectionRetry = null;
      element("preview-loading").hidden = true;
      element("loading-pulse").hidden = true;
      element("loading-retry").hidden = true;
      message = "Playing floating preview. F enters fullscreen; close with Esc, X, or click outside.";
      emitPreviewDebugLog("preview.select-phase", { surface: "playlist", layer: "ui", actionId: pending.actionId,
        selectionRequestId: pending.requestId, videoId: pending.videoId, phase: "success" });
      renderPlaylist();
      record("Selected a video through the inline preview player");
      return;
    }
    if (detail.phase === "playing") {
      emitPreviewDebugLog("preview.start-play", { surface: "playlist", layer: "ui", actionId: pending.actionId,
        videoId: detail.videoId, requestId: detail.requestId });
      return;
    }
    if (detail.phase !== "error") return;
    if (pending.committed && active.video.currentSrc === pending.source) {
      active.videoId = pending.previousVideoId;
      playlist.currentIndex = pending.previousIndex;
      active.qualityChange = null;
      for (const [anchor, href] of pending.previousHrefs) if (anchor.isConnected) anchor.href = href;
    }
    if (active.video.dataset.skipPreviewPlaylistRequest === pending.requestId) delete active.video.dataset.skipPreviewPlaylistRequest;
    pendingPlaylistSelection = null;
    message = typeof detail.error === "string" && detail.error ? detail.error : "The selected preview could not be loaded.";
    playlistSelectionRetry = pending.videoId;
    element("loading-status").textContent = message;
    element("loading-pulse").hidden = true;
    element("loading-retry").hidden = false;
    emitPreviewDebugLog("preview.select-phase", { surface: "playlist", layer: detail.layer ?? "page-bridge",
      actionId: pending.actionId, selectionRequestId: pending.requestId, videoId: pending.videoId,
      phase: "error", reason: message });
    renderPlaylist();
    record("Could not load the selected inline playlist preview");
  }
  function syncPlaylistLayout() {
    if (!session || (chapterSideTab.hidden && playlistSideTab.hidden)) return;
    const fullscreen = document.fullscreenElement === session.host;
    const destination = fullscreen ? session.host : document.documentElement;
    if (playlistChrome.parentElement !== destination) destination.append(playlistChrome);
    const rect = session.host.getBoundingClientRect();
    const geometry = playlistGeometry({ playerLeft: rect.left, playerTop: rect.top, playerWidth: rect.width, playerHeight: rect.height });
    for (const [name, value] of Object.entries({
      "drawer-left": geometry.drawerLeft, "drawer-top": geometry.drawerTop, "drawer-width": geometry.drawerWidth, "drawer-height": geometry.drawerHeight,
      "handle-left": geometry.handleLeft, "handle-top": geometry.handleTop, "handle-width": geometry.handleWidth, "handle-height": geometry.handleHeight,
      "player-right": rect.right, "player-top": rect.top, "player-height": rect.height,
    })) playlistSurface.style.setProperty(`--${name}`, `${value}px`);
    playlistSurface.dataset.edgeCovered = "true";
    if (playlist) playlistElement("playlist-meta").textContent = playlistInteractionHint(`${playlist.currentIndex + 1} / ${playlist.items.length}`);
  }
  function setPlaylistExpanded(open: boolean, focusTrigger = false) {
    if (!session?.playlistContext) return;
    if (open && typeof closeControlPages === "function") closeControlPages("playlist");
    playlistExpanded = open;
    if (open) {
      sidePanelTab = "playlist";
      chapterPanel.hidden = true;
      chapterButton.setAttribute("aria-expanded", "false");
    } else if (sidePanelTab === "playlist") sidePanelTab = null;
    chapterSideTab.setAttribute("aria-selected", String(sidePanelTab === "chapters"));
    playlistSideTab.setAttribute("aria-selected", String(sidePanelTab === "playlist"));
    playlistSurface.dataset.activeTab = sidePanelTab ?? "";
    playlistRevealed = false;
    playlistSurface.dataset.expanded = String(open);
    playlistSurface.dataset.revealed = "false";
    playlistButton.setAttribute("aria-expanded", String(open));
    playlistElement("playlist-meta").textContent = playlist ? playlistInteractionHint(`${playlist.currentIndex + 1} / ${playlist.items.length}`) : playlistError || previewUiCopy(uiLanguage).loadingPlaylist;
    if (open) queueMicrotask(() => { lastPlaylistScrollTop = playlistList.scrollTop; });
    if (!open && focusTrigger) playlistButton.focus({ preventScroll: true });
    showProgress();
  }
  function activatePlaylistItem(videoId: string, signal?: AbortSignal, requestedActionId?: string,
      requestedRect?: { left: number; top: number; width: number; height: number }) {
    if (!session || !playlist || pendingPlaylistSelection) return;
    if (videoId === session.videoId) { setPlaylistExpanded(false, true); return; }
    const active = session;
    const source = active.video.currentSrc;
    const itemIndex = playlist.items.findIndex(item => item.videoId === videoId);
    if (itemIndex < 0 || !active.playlistContext) return;
    const item = playlist.items[itemIndex];
    const row = playlistList.querySelector<HTMLElement>(`.playlist-item[data-video-id="${CSS.escape(videoId)}"]`);
    const measured = row?.getBoundingClientRect() ?? active.host.getBoundingClientRect();
    const rect = requestedRect ?? { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
    const actionId = requestedActionId ?? primePlaylistItem(videoId, rect, "click") ??
      `playlist-${++playlistActionSequence}-${Math.round(performance.now())}`;
    const startedAtMs = playlistPrimeIntent?.actionId === actionId ? playlistPrimeIntent.startedAtMs : performance.now();
    setPlaylistExpanded(false);
    const requestId = `${++playlistSelectionSequence}-${Math.round(performance.now())}`;
    pendingPlaylistSelection = { requestId, actionId, videoId, source, previousVideoId: active.videoId, previousIndex: playlist.currentIndex,
      previousHrefs: new Map([...active.host.querySelectorAll<HTMLAnchorElement>("a[href*='/watch?']")].map(anchor => [anchor, anchor.href])),
      committed: false };
    playlistSelectionRetry = null;
    element("controls").hidden = true;
    element("preview-loading").hidden = false;
    element("loading-status").textContent = previewUiCopy(uiLanguage).preparingNativePreview(item.title);
    element("loading-pulse").hidden = false;
    element("loading-retry").hidden = true;
    if (!active.video.paused) active.video.pause();
    const selection = {
      source, actionId, startedAtMs, videoId, playlistId: active.playlistContext.playlistId, requestId,
      retentionCapacity: playlistPreviewRetentionCapacity, retryLimit: playlistStageRetryLimit,
      timeoutMultipliers: playlistBrokerTimeoutMultipliers, rect,
      quality: qualityChoice?.owner === active ? qualityChoice.value : preferredQuality(qualityState?.available ?? []),
    };
    const pending = pendingPlaylistSelection;
    const handlePhase = (detail: PlaylistSelectPhase) => {
      if (session !== active || pendingPlaylistSelection !== pending || !active.video.isConnected) return;
      handlePlaylistSelectPhase(detail);
    };
    void pageBridge.request(active.video, "playlist-select", selection, {
      signal: signal ?? active.events.signal,
      onProgress: handlePhase,
    }).then(handlePhase, error => {
      handlePhase({
        requestId, actionId, videoId, playlistId: active.playlistContext?.playlistId ?? "", phase: "error",
        error: error instanceof Error ? error.message : "The selected preview could not be loaded.",
      });
    });
    record("Requested an inline playlist preview");
  }
  function setHoverSidePanelTab(tab: "chapters" | "playlist" | null) {
    sidePanelTab = tab;
    chapterPanel.hidden = tab !== "chapters";
    playlistSurface.dataset.activeTab = tab ?? "";
    chapterSideTab.setAttribute("aria-selected", String(tab === "chapters"));
    playlistSideTab.setAttribute("aria-selected", String(tab === "playlist"));
  }

  function hideHoverSidePanel() {
    playlistRevealed = false;
    playlistSurface.dataset.revealed = "false";
    setHoverSidePanelTab(null);
  }

  function updatePlaylistHover(event: PointerEvent) {
    if (!session || (chapterSideTab.hidden && playlistSideTab.hidden) || event.pointerType === "touch") return;

    // Panels opened from the bottom controls keep their existing close behavior.
    if (playlistSurface.dataset.expanded === "true") return;

    // Avoid revealing the side panel over unrelated control pages.
    if (!element("controls").hidden || infoViewer.isOpen()) {
      if (playlistRevealed) hideHoverSidePanel();
      return;
    }

    const rect = session.host.getBoundingClientRect();
    const geometry = playlistGeometry({
      playerLeft: rect.left,
      playerTop: rect.top,
      playerWidth: rect.width,
      playerHeight: rect.height,
    });

    const drawerRight = geometry.drawerLeft + geometry.drawerWidth;
    const drawerBottom = geometry.drawerTop + geometry.drawerHeight;

    const insidePanelY =
      event.clientY >= geometry.drawerTop &&
      event.clientY <= drawerBottom;

    // Reveal tabs as soon as the pointer enters the panel area.
    const insideRevealArea =
      insidePanelY &&
      event.clientX >= geometry.drawerLeft &&
      event.clientX <= drawerRight;

    // Open the matching page when the pointer enters the right half.
    const insideOpenArea =
      insidePanelY &&
      event.clientX >= geometry.drawerLeft + geometry.drawerWidth / 2 &&
      event.clientX <= drawerRight;

    // After reveal, the entire tabs + panel rectangle keeps the UI visible.
    const insideKeepArea =
      event.clientX >= geometry.drawerLeft - 72 &&
      event.clientX <= drawerRight &&
      insidePanelY;

    if (!playlistRevealed) {
      if (!insideRevealArea) return;

      playlistRevealed = true;
      playlistSurface.dataset.revealed = "true";
      setHoverSidePanelTab(null);
    } else if (!insideKeepArea && !insidePlaylistChrome(event)) {
      hideHoverSidePanel();
      return;
    }

    if (!insideOpenArea || sidePanelTab) return;

    let tab: "chapters" | "playlist";
    if (chapterSideTab.hidden) tab = "playlist";
    else if (playlistSideTab.hidden) tab = "chapters";
    else {
      const midpoint = geometry.drawerTop + geometry.drawerHeight / 2;
      tab = event.clientY < midpoint ? "chapters" : "playlist";
    }

    setHoverSidePanelTab(tab); requestAnimationFrame(updateSidePanelScrollbars);
  }
  window.addEventListener("pointermove", updatePlaylistHover, true);
  chapterSideTab.onclick = () => {
    if (chapterSideTab.hidden) return;
    if (playlistSurface.dataset.expanded === "true") {
      if (sidePanelTab !== "chapters")
        previewSession.dispatch({ type: "control", action: "toggle-chapters" });
      return;
    }
    if (playlistRevealed) setHoverSidePanelTab("chapters");
  };

  playlistSideTab.onclick = () => {
    if (playlistSideTab.hidden) return;
    if (playlistSurface.dataset.expanded === "true") {
      if (sidePanelTab !== "playlist")
        previewSession.dispatch({ type: "control", action: "toggle-playlist", value: true });
      return;
    }
    if (playlistRevealed) setHoverSidePanelTab("playlist");
  };
  playlistButton.onclick = () => previewSession.dispatch({ type: "control", action: "toggle-playlist" });
  playlistElement("playlist-close").onclick = () => previewSession.dispatch({ type: "control", action: "toggle-playlist", value: false });
  playlistPreviousButton.onclick = () => {
    if (!playlist || playlist.currentIndex <= 0) return;
    previewSession.dispatch({ type: "playlist", action: "select",
      videoId: playlist.items[playlist.currentIndex - 1].videoId });
  };
  playlistNextButton.onclick = () => {
    if (!playlist || playlist.currentIndex >= playlist.items.length - 1) return;
    previewSession.dispatch({ type: "playlist", action: "select",
      videoId: playlist.items[playlist.currentIndex + 1].videoId });
  };
  const style = document.createElement("style");
  style.textContent = `
    /* YouTube disables pointer events on a finished preview. Keep the pinned
       host interactive so controls do not click through to another thumbnail. */
    .${hostClass}{pointer-events:auto!important;}
    #skip-ads-preview-loading-host:not([data-skip-preview-owned-ready]){pointer-events:none!important;}
    .${hostClass} yt-progress-bar{display:none!important;}
    .${hostClass} .ytInlinePlayerControlsHost{display:none!important;}
    .${hostClass} #player-container-wrapper{opacity:1!important;}
    .${hostClass} .ytp-caption-window-container{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;pointer-events:none!important;}
    .${hostClass} .ytp-caption-window-bottom{bottom:10%!important;}
    .${hostClass} .caption-window{left:50%!important;right:auto!important;transform:translateX(-50%)!important;max-width:90%!important;height:auto!important;max-height:30%!important;text-align:center!important;}
    .${hostClass}:not(:fullscreen){box-shadow:0 22px 70px #000b,0 0 0 1px #a1bdd4b3,0 0 0 3px #142233a6!important;cursor:grab!important;}
    .${hostClass}:active{cursor:grabbing!important;}
    .${hostClass} .ytp-caption-segment{font-size:clamp(18px,1.7vw,32px)!important;}
    .${hostClass}.skip-ads-preview-captions-off .ytp-caption-window-container{display:none!important;}
    .${ancestorClass}{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;overflow:visible!important;clip-path:none!important;isolation:auto!important;z-index:auto!important;}
    .${hostClass}{display:block!important;visibility:visible!important;opacity:1!important;position:fixed!important;inset:auto!important;left:var(--skip-preview-left)!important;top:var(--skip-preview-top)!important;width:var(--skip-preview-width)!important;height:var(--skip-preview-height)!important;max-width:none!important;max-height:none!important;transform:none!important;margin:0!important;padding:0!important;z-index:2147483646!important;background:#000!important;overflow:hidden!important;border-radius:14px!important;box-shadow:0 24px 90px #000a,0 0 0 1px #ffffff24!important;}
    .${hostClass}:fullscreen{inset:0!important;width:100vw!important;height:100vh!important;border:none!important;outline:none!important;border-radius:0!important;box-shadow:none!important}
    .${hostClass} .${ancestorClass}{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important}
    .${hostClass} .${videoClass}{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;object-fit:contain!important;transform:none!important;}
    .${hostClass} #skip-ads-preview-prototype{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;max-width:none!important;pointer-events:none!important}
    .${hostClass}:fullscreen #skip-ads-preview-prototype{border:none!important;outline:none!important;box-shadow:none!important}
  `;
  const supportedPage = () => previewPageSupported(location.pathname);
  const ranges = (value: TimeRanges) => Array.from({ length: value.length }, (_, i) => [value.start(i), value.end(i)]);
  function snapshot() {
    if (!session) return { version: prototypeVersion, experiment: "shared-preview", sharedLatency, attached: false, enabled, autoSaveLogs, message, loading: !!loading,
      requestedVideo: pendingPin?.videoId ?? loading?.videoId };
    const v = session.video;
    return {
      version: prototypeVersion, experiment: "shared-preview", sharedLatency, attached: v.isConnected, enabled, autoSaveLogs, page: location.href, host: session.host.tagName.toLowerCase(),
      pageVisibility: document.visibilityState, documentHasFocus: document.hasFocus(),
      hostId: session.host.id, paused: v.paused, ended: v.ended,
      wantsPlayback: session.wantsPlayback,
      currentTime: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : String(v.duration),
      rate: v.playbackRate, muted: v.muted, volume: v.volume,
      videoWidth: v.videoWidth, videoHeight: v.videoHeight, quality: qualityState,
      source: v.currentSrc, pinnedSource: session.source, qualityChanging: Boolean(session.qualityChange),
      requestedMuted: session.requestedMuted, preservedUnmuteEvents: session.preservedUnmuteEvents,
      readyState: v.readyState, networkState: v.networkState,
      mediaUnavailable: v.readyState === 0,
      seekable: ranges(v.seekable), buffered: ranges(v.buffered),
      fullscreen: document.fullscreenElement === session.host,
      viewingMode: document.fullscreenElement === session.host ? "fullscreen" : "floating", floating: session.floating,
      playlist: typeof playlist !== "undefined" && playlist ? { title: playlist.title, count: playlist.items.length, currentIndex: playlist.currentIndex,
        expanded: playlistExpanded, direction: "right-to-left", preparationPolicy: "single-current-intent",
        retentionCapacity: playlistPreviewRetentionCapacity, stageRetryLimit: playlistStageRetryLimit,
        timeoutMultipliers: playlistBrokerTimeoutMultipliers, autoplay: playlistAutoplay,
        activePreparation: playlistPrimeIntent ? {
          actionId: playlistPrimeIntent.actionId, videoId: playlistPrimeIntent.videoId, trigger: playlistPrimeIntent.trigger,
        } : null, previewStates: Object.fromEntries(playlistPreviewStates) } : null,
      captions: captionState, subtitlesVisible: captionChoice ?? captionState?.enabled ?? false,
      audioTracks: v.audioTracks?.length ?? "Unavailable in this browser",
      audioDecodedBytes: v.webkitAudioDecodedByteCount ?? "Unavailable in this browser",
      audibleUserReport: heard, mediaError: v.error?.message ?? null,
    };
  }
  function record(action: string) {
    diagnosticSession.record("observation.record", { action, state: snapshot() });
    render();
  }
  function render() {
    const copy = previewUiCopy(uiLanguage);
    refreshQuality();
    refreshCaptions();
    refreshChapters();
    infoViewer.sync();
    infoButton.setAttribute("aria-expanded", String(infoViewer.isOpen()));
    element("message").textContent = message;
    element("enable").setAttribute("aria-checked", String(enabled));
    element("enable").title = `${copy.inlineVideoPreviews}: ${enabled ? copy.on : copy.off}`;
    element("enabled-state").textContent = enabled ? copy.on : copy.off;
    for (const control of shadow.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>("[data-active]")) control.disabled = !session;
    element<HTMLButtonElement>("play").disabled = !session || Boolean(pendingPlaylistSelection);
    element<HTMLButtonElement>("captions").disabled = !session || !(captionState?.available || captionChoice !== null);
    const fullscreen = Boolean(session && document.fullscreenElement === session.host);
    element("fullscreen").setAttribute("aria-label", fullscreen ? copy.exitFullscreen : copy.enterFullscreen);
    element("fullscreen").dataset.tooltip = fullscreen ? copy.exitFullscreenTooltip : copy.enterFullscreenTooltip;
    element("top-controls").hidden = !loading && (!session || element("progress-display").hidden);
    element<HTMLButtonElement>("release").disabled = !session && !loading;
    resizeHandles.hidden = !session || fullscreen;
    element("settings").setAttribute("aria-expanded", String(!element("controls").hidden));
    element("state").textContent = JSON.stringify(snapshot(), null, 2);
    element("audio").textContent = `Listening result: ${heard}. Unmuted or decoded audio does not prove audible sound.`;
    const progress = element<HTMLInputElement>("progress");
    const v = session?.video;
    const playing = Boolean(v && !v.paused && !v.ended);
    element("play").dataset.playing = String(playing);
    element("play").setAttribute("aria-label", playing ? copy.pauseLabel : copy.playLabel);
    element("play").dataset.tooltip = playing ? copy.pauseTooltip : copy.playTooltip;
    const muted = Boolean(v && (session?.requestedMuted ?? v.muted));
    element("speaker").dataset.muted = String(muted);
    element("speaker").setAttribute("aria-label", muted ? copy.unmute : copy.mute);
    element("speaker-tip").textContent = muted ? copy.unmute : copy.mute;
    const spans = v ? ranges(v.seekable) : [];
    progress.disabled = !spans.length;
    progress.min = String(spans[0]?.[0] ?? 0);
    progress.max = String(spans.at(-1)?.[1] ?? 1);
    if (!scrubbing) progress.value = String(v?.currentTime ?? 0);
    const elapsed = formatTime(v?.currentTime ?? 0);
    const total = formatTime(v?.duration ?? NaN);
    element("time").textContent = `${elapsed} / ${total}`;
    progress.setAttribute("aria-valuetext", copy.progressOf(elapsed, total));
    if (session) {
      const speed = element<HTMLSelectElement>("speed");
      const volume = element<HTMLInputElement>("volume");
      if (shadow.activeElement !== speed) speed.value = String(session.video.playbackRate);
      if (shadow.activeElement !== volume) volume.value = String(session.video.volume);
    }
    selectControls.sync();
  }
  function refreshQuality(choice?: string) {
    const v = session?.video;
    if (qualityChoice?.owner !== session) qualityChoice = null;
    if (qualityVideo !== v || qualityState?.source !== v?.currentSrc) qualityState = null;
    qualityVideo = v ?? null;
    if (v) {
      const requestSource = v.currentSrc;
      void pageBridge.request(v, "quality", { source: requestSource, quality: choice }, { signal: session?.events.signal }).then((state: QualityState) => {
        if (session?.video !== v) return;
        if (state.source === requestSource) {
          qualityState = state;
          if (choice && state.requested === choice && !state.error && session) {
            qualityChoice = { owner: session, value: choice, at: state.requestedAt };
          }
        }
        applyDefaultQuality();
      }, () => {});
    }
    if (qualityState && qualityChoice) {
      qualityState.requested = qualityChoice.value;
      qualityState.requestedAt = qualityChoice.at;
    }
    const select = element<HTMLSelectElement>("quality");
    const available = qualityState?.available ?? [];
    const options = ["auto", ...available];
    const qualityOptionLabel = (quality: string) => quality === "auto" ? previewUiCopy(uiLanguage).qualityAuto
      : quality === "highres" ? previewUiCopy(uiLanguage).qualityHighest : qualityLabels[quality];
    if ([...select.options].map(o => o.value).join(",") !== options.join(",")) {
      select.replaceChildren(...options.map(q => node("option", { value: q }, qualityOptionLabel(q))));
    } else {
      for (const option of select.options) option.textContent = qualityOptionLabel(option.value);
    }
    select.disabled = !v || !qualityState?.supported || Boolean(session?.qualityChange);
    select.value = qualityState?.requested ?? "auto";
    const copy = previewUiCopy(uiLanguage);
    const resolution = v?.videoWidth && v.videoHeight ? `${v.videoWidth} × ${v.videoHeight}` : copy.waitingForVideo;
    const requested = qualityState?.requested;
    const changing = requested && requested !== "auto" && qualityState?.current !== requested;
    const status = !v ? copy.startPreviewForQuality : qualityState?.error ? copy.previewError(qualityState.error) :
      (!qualityState?.supported ? copy.qualityUnavailable : changing ?
        (Date.now() - qualityState.requestedAt > 15000 ? copy.qualityStillDifferent(qualityOptionLabel(requested)) : copy.qualitySwitching(qualityOptionLabel(requested))) :
        requested === "auto" ? copy.qualityAutomatic : "");
    const statusText = v ? copy.qualityPlaying(resolution, status) : status;
    if (element("quality-status").textContent !== statusText) element("quality-status").textContent = statusText;
  }
  function refreshChapters() {
    const active = session;
    if (metadataOwner !== active) {
      metadataOwner = active; metadata = null; chapterSignature = ""; metadataRequestSource = ""; chapterPanel.hidden = true;
      if (active) requestChapters();
    }
    if (active && metadataRequestSource !== active.video.currentSrc) requestChapters();
    const chapters = metadata?.chapters ?? [];
    chapterButton.hidden = chapters.length === 0;
    chapterSideTab.hidden = chapterButton.hidden;
    playlistChrome.hidden = chapterButton.hidden && !session?.playlistContext;
    if (!playlistChrome.hidden) syncPlaylistLayout();
    if (chapterButton.hidden) {
      chapterPanel.hidden = true;
      if (sidePanelTab === "chapters") sidePanelTab = null;
      chapterSideTab.setAttribute("aria-selected", "false");
      chapterButton.setAttribute("aria-expanded", "false");
    }
    const current = chapters.findLast(c => c.start <= (active?.video.currentTime ?? 0));
    element("chapter-title").textContent = current?.title ?? previewUiCopy(uiLanguage).chaptersLabel;
    chapterButton.setAttribute("aria-label", current ? previewUiCopy(uiLanguage).chaptersCurrent(current.title) : previewUiCopy(uiLanguage).chaptersLabel);
    chapterButton.dataset.tooltip = previewUiCopy(uiLanguage).viewChapters;
    chapterButton.setAttribute("aria-expanded", String(!chapterPanel.hidden));
    const signature = JSON.stringify([Boolean(active), metadata?.error, chapters]);
    if (signature !== chapterSignature) {
      chapterSignature = signature;
      const list = chapterPanel.querySelector<HTMLElement>("#chapter-list")!;
      if (!chapters.length) {
        list.replaceChildren(node("p", {}, metadata?.error || (metadata ? previewUiCopy(uiLanguage).noChapters : active ? previewUiCopy(uiLanguage).loadingChapters : previewUiCopy(uiLanguage).openPreviewForChapters)));
        if (metadata?.error) { const retry = button("retry-chapters", previewUiCopy(uiLanguage).tryAgain); retry.onclick = () => { requestChapters(); refreshChapters(); }; list.append(retry); }
      } else list.replaceChildren(...chapters.map(c => {
        const item = node("button", { class: "chapter-item", "data-start": String(c.start) },
          node("span", { class: "chapter-copy" }, node("span", {}, c.title), node("small", {}, formatTime(c.start))));
        if (typeof c.thumbnail === "string" && /^https:\/\/([\w-]+\.)?(ytimg\.com|ggpht\.com)\//.test(c.thumbnail)) item.prepend(node("img", { src: c.thumbnail, alt: "", loading: "lazy" }));
        item.onclick = () => previewSession.dispatch({ type: "control", action: "seek-to", value: c.start });
        return item;
      }));
    }
    for (const item of chapterPanel.querySelectorAll<HTMLElement>(".chapter-item"))
      item.setAttribute("aria-current", String(Number(item.dataset.start) === current?.start));
    requestAnimationFrame(updateSidePanelScrollbars);
  }
  function requestChapters() {
    if (!session) return;
    metadata = null; chapterSignature = "";
    metadataRequestSource = session.video.currentSrc;
    const active = session;
    void pageBridge.request(active.video, "metadata", { source: active.video.currentSrc }, { signal: active.events.signal }).then((result: PreviewMetadata) => {
      if (session !== active || result.source !== active.video.currentSrc ||
          result.videoId !== watchId(active.host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href)) return;
      metadata = result; record("Loaded native chapter metadata");
    }, () => {});
  }
  function refreshCaptions(choice?: boolean, track?: string, translation?: string) {
    const active = session;
    if (captionOwner !== active) { captionOwner = active; captionState = null; captionChoice = active ? false : null; captionTrackChoice = ""; captionTranslationChoice = ""; }
    if (choice !== undefined) captionChoice = choice;
    if (active) {
      const v = active.video;
      const source = v.currentSrc;
      // Reapply an explicit choice after a native quality reload, without
      // continually toggling the player's own caption state during playback.
      const requested = choice ?? (captionChoice === false || captionState && captionState.source !== source ? captionChoice ?? undefined : undefined);
      const restore = Boolean(captionState && captionState.source !== source || choice === true);
      const requestedTrack = track ?? (restore && captionTrackChoice ? captionTrackChoice : undefined);
      const requestedTranslation = translation ?? (track !== undefined ? "" : restore ? captionTranslationChoice : undefined);
      void pageBridge.request(v, "captions", { source, enabled: requested, track: requestedTrack, translation: requestedTranslation }, { signal: active.events.signal }).then((state: CaptionState) => {
        if (session === active && state.source === source) {
          captionState = state;
          if (state.selectedTrack) { captionTrackChoice = state.selectedTrack; captionTranslationChoice = state.translation; }
        }
      }, () => {});
      // Hiding the overlay also removes an already-rendered cue immediately
      // while paused, and stays effective across native caption recreation.
      active.host.classList.toggle("skip-ads-preview-captions-off", captionChoice === false);
    }
    const on = captionChoice ?? captionState?.enabled ?? false;
    element("captions").setAttribute("aria-pressed", String(on));
    element("captions").dataset.tooltip = on ? previewUiCopy(uiLanguage).hideSubtitles : previewUiCopy(uiLanguage).showSubtitles;
    const language = element<HTMLSelectElement>("caption-language");
    const tracks = captionState?.tracks ?? [];
    const options = tracks.length ? tracks : [{ id: "", label: previewUiCopy(uiLanguage).unavailable }];
    const signature = JSON.stringify(options.map(t => [t.id, t.label]));
    if (language.dataset.options !== signature) {
      language.replaceChildren(...options.map(t => node("option", { value: t.id }, t.label)));
      language.dataset.options = signature;
    }
    language.disabled = !active || !captionState?.languageSupported;
    language.value = captionState?.selectedTrack || captionTrackChoice || options[0].id;
    const translate = element<HTMLSelectElement>("caption-translation");
    const copy = previewUiCopy(uiLanguage);
    const translations = [{ languageCode: "", label: copy.translationOff }, ...(captionState?.translations ?? [])];
    const translationSignature = JSON.stringify(translations);
    if (translate.dataset.options !== translationSignature) {
      translate.replaceChildren(...translations.map(t => node("option", { value: t.languageCode }, t.label)));
      translate.dataset.options = translationSignature;
    }
    translate.disabled = !active || !captionState?.languageSupported || translations.length < 2;
    translate.value = captionState?.enabled ? captionState.translation : captionTranslationChoice;
    const status = !active ? copy.startPreviewForSubtitles : captionState?.error ? copy.previewError(captionState.error)
      : !captionState?.available && captionChoice === null ? copy.subtitlesUnavailable : "";
    if (element("caption-status").textContent !== status) element("caption-status").textContent = status;
  }
  function toggleCaptions() {
    if (!session) return;
    refreshCaptions();
    if (!captionState?.available && captionChoice === null) return;
    const on = captionChoice ?? captionState?.enabled ?? false;
    refreshCaptions(!on);
    record(on ? "Subtitles hidden" : "Subtitles shown");
  }
  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
    const value = Math.floor(seconds);
    const minutes = Math.floor(value / 60) % 60;
    const tail = `${minutes}:${String(value % 60).padStart(2, "0")}`;
    return value >= 3600 ? `${Math.floor(value / 3600)}:${tail.padStart(5, "0")}` : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
  }
  function showProgress() {
    if (!session) return;
    element("progress-display").hidden = false;
    element("top-controls").hidden = false;
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => {
      if (scrubbing || dragging || session?.video.paused || !element("controls").hidden ||
          element("progress-display").matches(":hover,:focus-within") || element("top-controls").matches(":hover,:focus-within")) { showProgress(); return; }
      element("progress-display").hidden = true;
      element("top-controls").hidden = true;
    }, 3000);
  }
  function findPreview(allowPaused = false, videoId?: string) {
    return [...document.querySelectorAll<AudioVideo>("video")].find(v => {
      const host = resolvePreviewHost(v);
      if (host?.hasAttribute("data-skip-preview-owned") && host.dataset.skipPreviewOwnedReady !== host.dataset.skipPreviewOwned) return false;
      if (!host || v.closest(`ytd-miniplayer,${shortsSelector}`) || !v.isConnected ||
          v.ended || (!allowPaused && v.paused) || v.readyState < 2) return false;
      // Explicit playback intent can adopt a decoded native stream before its
      // thumbnail is laid out. Repeated native preview reuse can leave ready
      // media at zero size; pin() supplies the floating layout itself. Keep
      // strict identity matching so a previous thumbnail cannot win this race.
      if (videoId) return watchId(host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href) === videoId;
      const rect = v.getBoundingClientRect();
      return rect.width > 40 && rect.height > 40 &&
        rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth &&
        getComputedStyle(v).visibility !== "hidden";
    });
  }
  function positionPlayer(reset = false) {
    if (!session) {
      if (loading) {
        loading.floating = floatingRect(innerWidth, innerHeight, loading.floating);
        for (const [key, value] of Object.entries(loading.floating)) loading.host.style.setProperty(`--skip-preview-${key}`, `${value}px`);
      }
      return;
    }
    if (document.fullscreenElement === session.host) return;
    session.floating = floatingRect(innerWidth, innerHeight, reset ? undefined : session.floating, session.aspectRatio);
    for (const [key, value] of Object.entries(session.floating)) session.host.style.setProperty(`--skip-preview-${key}`, `${value}px`);
    if (typeof syncPlaylistLayout === "function") syncPlaylistLayout();
  }
  window.addEventListener("resize", () => positionPlayer());
  function pin(candidate?: AudioVideo, playlistContext?: PlaylistContext) {
    if (session || !enabled || !supportedPage()) return;
    const video = candidate ?? findPreview();
    // The player itself sits inside a /watch link. Mount our panel on the outer
    // preview instead, outside that link and above the site's sidebar/header.
    const host = video ? resolvePreviewHost(video) : null;
    if (!video || !host) {
      message = "No playable preview found. Hover over the thumbnail until it plays, then click it.";
      record("No active preview found");
      return;
    }
    const ancestors: HTMLElement[] = [];
    for (let parent = video.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      if (parent !== host) ancestors.push(parent);
    }
    const videoId = watchId(host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href);
    session = {
      video, host, videoId, ancestors, source: video.currentSrc,
      initial: { muted: video.muted, volume: video.volume, rate: video.playbackRate },
      events: new AbortController(), previousFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      muteRequest: null,
      requestedMuted: null, preservedUnmuteEvents: 0, fullscreenEntered: false, wantsPlayback: true, debugPlaybackStarted: false,
      startupQualityPending: true, startupQualityUntil: performance.now() + 1500,
      aspectRatio: video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9,
      playlistContext, previewTarget: resolvePreviewThumbnail(loading?.target ?? host, location.href)?.target as HTMLElement | undefined,
    };
    heard = "Not checked";
    activationMessage = "";
    host.classList.add(hostClass);
    if (playlistContext) host.dataset.skipPreviewPlaylistId = playlistContext.playlistId;
    video.classList.add(videoClass);
    emitPreviewDebugLog("resource.create", { resource: "pinned-preview", key: videoId ?? "unknown" });
    ancestors.forEach(parent => parent.classList.add(ancestorClass));
    host.append(panel);
    document.documentElement.append(backdrop);
    backdrop.hidden = false;
    backdrop.style.pointerEvents = "auto";
    if (loading) {
      session.floating = loading.floating;
      positionPlayer();
      session.animation = loading.animation;
      if (loading.animation?.effect instanceof KeyframeEffect) loading.animation.effect.target = host;
      if (loading.host !== host) loading.host.remove(); loading = null;
    } else {
      positionPlayer(true);
      session.animation = animatePlayer(host, true);
    }
    element("preview-loading").hidden = false;
    element("loading-status").textContent = previewUiCopy(uiLanguage).preparingPreferredResolution;
    element("loading-pulse").hidden = false;
    if (!video.paused) video.pause();
    host.addEventListener("pointermove", event => {
      if (event.pointerType === "mouse" && supportedPage()) showProgress();
    }, { capture: true, signal: session.events.signal });
    for (const name of ["volumechange", "ratechange", "seeking", "seeked", "play", "pause", "ended", "loadedmetadata", "emptied", "error"]) {
      video.addEventListener(name, () => record(`Media event: ${name}`), { signal: session.events.signal });
    }
    const active = session;
    video.addEventListener("pause", () => {
      // Captured normal-Chrome entries pause ~300ms AFTER requestFullscreen
      // resolves. Reconcile that late startup pause once, not on every pause.
      // Explicit controls cancel recovery before pausing; release aborts this
      // listener. Never revive an ended, replaced or unavailable media source.
      if (session !== active || active.startupQualityPending || !video.paused) return;
      const playable = !video.ended && video.readyState >= 2 && video.isConnected && video.currentSrc === active.source;
      const before = video.paused;
      previewSession.dispatch({ type: "lifecycle", event: "media-pause", playable });
      if (before && playable && active.wantsPlayback) record("Reconciled delayed browser pause through preview session");
    }, { signal: active.events.signal });
    video.addEventListener("play", () => {
      if (session === active && active.startupQualityPending && !video.paused) video.pause();
      else if (session === active && !active.debugPlaybackStarted) {
        active.debugPlaybackStarted = true;
        emitPreviewDebugLog("preview.start-play", { surface: "thumbnail", videoId: active.videoId ?? "" });
      }
    }, { signal: active.events.signal });
    message = "Preparing the preferred resolution before playback.";
    element("controls").hidden = true;
    showProgress();
    panel.tabIndex = -1;
    panel.focus({ preventScroll: true });
    unmute(false);
    if (videoId) active.startupRestore = { until: performance.now() + 3000, videoId,
      time: video.currentTime, muted: video.muted, volume: video.volume, rate: video.playbackRate, preserveTime: false };
    refreshQuality();
    applyDefaultQuality();
    reconcileStartupPlayback();
    record("Pinned original preview media element");
  }
  function finishStartupPlayback(active: Session) {
    if (session !== active || !active.startupQualityPending) return;
    active.startupQualityPending = false;
    if (sharedLatency?.videoId === active.videoId) {
      sharedLatency.visibleMs = Math.round(performance.now() - sharedLatency.startedAt);
      emitPreviewDebugLog("preview.experiment-visible", { ...sharedLatency });
    }
    element("preview-loading").hidden = true;
    element("loading-pulse").hidden = true;
    message = "Playing floating preview. F enters fullscreen; close with Esc, X, or click outside.";
    previewSession.dispatch({ type: "lifecycle", event: "startup-ready" });
    if (typeof refreshPlaylist === "function") refreshPlaylist();
    record("Completed preview startup after resolution preparation");
  }
  function reconcileStartupPlayback() {
    const active = session;
    if (!active?.startupQualityPending) return;
    if (!active.video.paused) active.video.pause();
    if (active.qualityChange) return;
    if (!active.defaultQualityApplied && !qualityState && performance.now() <= active.startupQualityUntil) return;
    active.defaultQualityApplied = true;
    finishStartupPlayback(active);
  }
  function release(reason = "Released preview. Click another playing preview to watch.", keepPlayerHost?: HTMLElement) {
    pendingPin = null;
    discardLoading();
    if (!session) return;
    scrollDiagnostics.flush(playlistScrollSnapshot());
    record(reason);
    const old = session;
    cancelPlaylistPrime("session-release");
    cancelReadyPlaylistResponses("session-release");
    session = null;
    emitPreviewDebugLog("resource.release", { resource: "pinned-preview", key: old.videoId ?? "unknown", reason });
    lastReleasedPreview = { video: old.video, videoId: old.videoId, at: performance.now() };
    backdrop.hidden = true;
    backdrop.style.pointerEvents = "auto";
    dragging = null;
    resizing = null;
    if (typeof playlistChrome !== "undefined") {
      pendingPlaylistSelection = null;
      playlistSelectionRetry = null;
      delete old.video.dataset.skipPreviewPlaylistRequest;
      playlist = null;
      playlistError = "";
      playlistPreviewStates.clear();
      playlistPreviewActions.clear();
      playlistPrimeIntent = null;
      playlistRequestSequence++;
      playlistExpanded = false;
      playlistRevealed = false;
      playlistChrome.hidden = true;
      playlistSurface.dataset.expanded = "false";
      playlistSurface.dataset.revealed = "false";
      playlistButton.hidden = true;
      playlistAutoplayButton.hidden = true;
      document.documentElement.append(playlistChrome);
    }
    suppressDragClickUntil = 0;
    selectControls.close();
    scrubbing = false;
    clearTimeout(progressTimer);
    clearTimeout(volumeFeedbackTimer);
    clearTimeout(speedFeedbackTimer);
    element("speed-feedback").dataset.visible = "false";
    element("speed-feedback").setAttribute("aria-hidden", "true");
    element("volume-feedback").dataset.visible = "false";
    element("volume-feedback").setAttribute("aria-hidden", "true");
    element("preview-loading").hidden = true;
    element("loading-pulse").hidden = true;
    element("loading-retry").hidden = true;
    element("progress-display").hidden = true;
    element("controls").hidden = true;
    old.events.abort();
    old.animation?.cancel();
    for (const [anchor, href] of old.originalWatchHrefs ?? []) if (anchor.isConnected) anchor.href = href;
    if (document.fullscreenElement === old.host) void document.exitFullscreen().catch(() => {});
    old.host.classList.remove(hostClass);
    if (old.host.dataset) delete old.host.dataset.skipPreviewPlaylistId;
    for (const key of ["left", "top", "width", "height"]) old.host.style.removeProperty(`--skip-preview-${key}`);
    old.host.classList.remove("skip-ads-preview-captions-off");
    old.video.classList.remove(videoClass);
    old.ancestors.forEach(parent => parent.classList.remove(ancestorClass));
    document.documentElement.append(panel);
    if (old.host !== keepPlayerHost) old.host.dispatchEvent(new CustomEvent(sharedPreviewCancelEvent));
    sharedUiEvents?.abort(); sharedUiEvents = null;
    if (old.previewTarget && old.videoId) thumbnailState(old.previewTarget, old.videoId, "idle");
    if (old.host.hasAttribute("data-skip-preview-owned") && old.host !== keepPlayerHost) old.host.remove();
    panel.style.setProperty("bottom", "16px");
    if (old.video.isConnected && old.video.currentSrc === old.source) {
      old.video.muted = old.initial.muted;
      old.video.volume = old.initial.volume;
      old.video.playbackRate = old.initial.rate;
    }
    old.previousFocus?.focus({ preventScroll: true });
    message = reason;
    render();
  }
  async function play() {
    const active = session;
    if (!active || active.startupQualityPending) return;
    showProgress();
    try { await active.video.play(); }
    catch (error) {
      if (session !== active) return;
      message = `Playback rejected: ${error instanceof Error ? error.message : String(error)}`;
      record("Playback rejected");
    }
  }
  function unmute(startPlayback = true) {
    if (!session) return;
    const v = session.video;
    // Try the existing player's mute control first so its own state can follow.
    // Never toggle a player that is already unmuted.
    setMuted(false);
    if (v.volume === 0) v.volume = 0.5;
    heard = "Not checked after unmute";
    if (startPlayback) {
      message = "Unmute requested. Listen now; if silent, try a spoken section and check Troubleshooting.";
      void play();
    }
    record(startPlayback ? "User requested unmute and play" : "Prepared unmuted startup audio");
  }
  function setMuted(muted: boolean, settle = true) {
    if (!session) return;
    session.requestedMuted = muted;
    if (session.qualityChange) session.qualityChange.muted = muted;
    if (session.fullscreenRestore) session.fullscreenRestore.muted = muted;
    if (session.startupRestore) session.startupRestore.muted = muted;
    const v = session.video;
    const native = session.host.querySelector<HTMLElement>(".ytmMuteButtonButton, .ytp-mute-button");
    // Live YouTube can apply its initial mute state after the first video frame
    // and sound button appear. Honor the user's request for a bounded startup
    // window; do not permanently fight later player decisions.
    if (settle) session.muteRequest = { value: muted, ticksLeft: 6 };
    if (v.muted !== muted) {
      // Observed on live desktop inline playback; this updates YouTube's own
      // mute preference as well as the media element, preventing re-muting.
      nativeAction = true;
      try { native?.click(); } finally { nativeAction = false; }
    }
    v.muted = muted;
    if (typeof CustomEvent === "function") v.dispatchEvent(new CustomEvent(playlistAudioChangeEvent));
    record(muted ? "Muted" : "Unmuted through inline control");
  }
  function seek(delta: number) {
    if (session) seekTo(session.video.currentTime + delta);
  }
  function seekTo(target: number) {
    if (!session) return;
    const v = session.video;
    const spans = ranges(v.seekable);
    if (!spans.length) {
      message = "This preview reports no seekable range yet.";
      record("Seek unavailable");
      return;
    }
    const candidates = spans.map(([start, end]) => Math.min(Math.max(start, end - 0.05), Math.max(start, target)));
    const chosen = candidates.reduce((a, b) => Math.abs(a - target) < Math.abs(b - target) ? a : b);
    v.currentTime = chosen;
    if (session.qualityChange) session.qualityChange.time = chosen;
    if (session.fullscreenRestore) session.fullscreenRestore.time = chosen;
    showProgress();
    record(`Requested seek to ${chosen.toFixed(2)}s`);
  }
  async function enterFullscreen() {
    const active = session;
    if (!active || active.fullscreenPending) return;
    active.fullscreenRequested = true;
    active.fullscreenPending = true;
    previewSession.dispatch({ type: "lifecycle", event: "arm-playback-recovery" });
    try {
      await active.host.requestFullscreen();
      // Closing/navigation can release, or Esc can cancel, during entry.
      if (session !== active || !active.fullscreenRequested) {
        if (document.fullscreenElement === active.host && (session === active || session?.host !== active.host)) {
          await document.exitFullscreen();
        }
        return;
      }
      if (document.fullscreenElement !== active.host) {
        throw new Error("The browser did not enter fullscreen");
      }
      active.fullscreenEntered = true;
      // The native player can pause while its fullscreen layout is changing.
      // Reconcile once after entry, respecting a pause requested meanwhile.
      if (session !== active) return;
      record("Entered fullscreen preview");
    } catch (error) {
      if (session !== active) return;
      active.fullscreenRequested = false;
      message = `Fullscreen could not start: ${error instanceof Error ? error.message : String(error)}. The floating preview remains available.`;
      element("controls").hidden = false;
      record("Fullscreen rejected");
    } finally {
      active.fullscreenPending = false;
    }
  }
  async function exitFullscreen() {
    const active = session;
    if (!active) return;
    active.fullscreenRequested = false;
    if (document.fullscreenElement !== active.host) return;
    previewSession.dispatch({ type: "lifecycle", event: "arm-playback-recovery" });
    try { await document.exitFullscreen(); }
    catch { if (session === active) { message = "Fullscreen could not exit. Press Esc to return to the floating preview."; record("Fullscreen exit rejected"); } }
  }
  function toggleFullscreen() {
    if (!session) return;
    if (document.fullscreenElement === session.host || session.fullscreenRequested) void exitFullscreen();
    else void enterFullscreen();
  }
  function toggleMute() {
    if (!session) return;
    // YouTube's M shortcut only changes mute. Starting playback is a separate
    // explicit play/pause action.
    const muted = session.requestedMuted ?? session.video.muted;
    setMuted(!muted);
    if (session.qualityChange) session.qualityChange.volume = session.video.volume;
    if (session.fullscreenRestore) session.fullscreenRestore.volume = session.video.volume;
    if (session.startupRestore) session.startupRestore.volume = session.video.volume;
    render();
  }
  function applyEnabledPreference(value: unknown) {
    enabled = typeof value === "boolean" ? value : true;
    if (!enabled && session) {
      release("Preview mode is off. YouTube clicks work normally.");
      element("controls").hidden = false;
    }
    render();
  }
  let enabledPreferenceChanged = false;
  element("enable").onclick = () => {
    enabledPreferenceChanged = true;
    enabled = !enabled;
    pendingPin = null;
    activationMessage = "";
    void chrome.storage.local.set({ [enabledKey]: enabled });
    if (!enabled) {
      release("Preview mode is off. YouTube clicks work normally.");
      // Keep the switch available after turning it off in the panel.
      element("controls").hidden = false;
    }
    record(enabled ? "Preview mode enabled" : "Preview mode disabled");
  };
  void chrome.storage.local.get(enabledKey).then(values => {
    if (!enabledPreferenceChanged) applyEnabledPreference(values[enabledKey]);
  }, () => {
    if (!enabledPreferenceChanged) applyEnabledPreference(true);
  });
  updateSearchControl = () => {
    const copy = previewUiCopy(uiLanguage);
    videoIdSearchButton.textContent = copy.urlSearchVideoId;
    urlSearchButton.textContent = copy.urlSearchFullUrl;
    videoIdSearchButton.setAttribute("aria-pressed", String(!urlSearchEnabled));
    urlSearchButton.setAttribute("aria-pressed", String(urlSearchEnabled));
  };
  updateSearchControl();
  function setSearchMode(useUrl: boolean) {
    if (useUrl === urlSearchEnabled) return;
    void searchPreference.set(useUrl).catch(() => {
      element("message").textContent = previewUiCopy(uiLanguage).settingsSaveFailed;
    });
  }
  videoIdSearchButton.onclick = () => setSearchMode(false);
  urlSearchButton.onclick = () => setSearchMode(true);
  function applyPlaylistRetentionCapacity(value: unknown) {
    playlistPreviewRetentionCapacity = normalizePlaylistPreviewRetentionCapacity(value);
    playlistRetentionInput.value = String(playlistPreviewRetentionCapacity);
    playlistRetentionInput.setAttribute("aria-valuetext", previewUiCopy(uiLanguage).readyPreviews(playlistPreviewRetentionCapacity));
    selectControls.sync();
    if (session?.playlistContext) {
      session.video.dispatchEvent(new CustomEvent(playlistPreviewRetentionEvent, { bubbles: true, detail: JSON.stringify({
        capacity: playlistPreviewRetentionCapacity,
      }) }));
    }
  }
  let playlistRetentionPreferenceChanged = false;
  playlistRetentionInput.oninput = () => {
    playlistRetentionPreferenceChanged = true;
    applyPlaylistRetentionCapacity(playlistRetentionInput.value);
  };
  playlistRetentionInput.onchange = () => {
    playlistRetentionPreferenceChanged = true;
    applyPlaylistRetentionCapacity(playlistRetentionInput.value);
    void savePlaylistPreviewRetentionCapacity(chrome.storage.local, playlistPreviewRetentionCapacityKey,
      playlistPreviewRetentionCapacity);
  };
  void loadPlaylistPreviewRetentionCapacity(chrome.storage.local, playlistPreviewRetentionCapacityKey).then(
    value => { if (!playlistRetentionPreferenceChanged) applyPlaylistRetentionCapacity(value); },
    () => { if (!playlistRetentionPreferenceChanged) applyPlaylistRetentionCapacity(defaultPlaylistPreviewRetentionCapacity); },
  );
  function applyPlaylistStageRetryLimit(value: unknown) {
    playlistStageRetryLimit = normalizePlaylistStageRetryLimit(value);
    const attempts = playlistStageRetryLimit + 1;
    applySettingsChoice(playlistStageAttemptsControl, attempts);
  }
  let playlistStageRetryPreferenceChanged = false;
  playlistStageAttemptsControl.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-value]") : null;
    if (!button || !playlistStageAttemptsControl.contains(button)) return;
    playlistStageRetryPreferenceChanged = true;
    applyPlaylistStageRetryLimit(Number(button.dataset.value) - 1);
    void savePlaylistStageRetryLimit(chrome.storage.local, playlistStageRetryLimitKey, playlistStageRetryLimit);
    record(`Playlist retry limit set to ${playlistStageRetryLimit} per stage`);
  });
  void loadPlaylistStageRetryLimit(chrome.storage.local, playlistStageRetryLimitKey).then(
    value => { if (!playlistStageRetryPreferenceChanged) applyPlaylistStageRetryLimit(value); },
    () => { if (!playlistStageRetryPreferenceChanged) applyPlaylistStageRetryLimit(defaultPlaylistStageRetryLimit); },
  );
  function applyPlaylistBrokerTimeoutMultipliers(value: unknown) {
    playlistBrokerTimeoutMultipliers = normalizePlaylistBrokerTimeoutSettings(value);
    for (const stage of ["starting", "ready", "request"] as const) {
      const seconds = playlistBrokerTimeoutSeconds(stage, playlistBrokerTimeoutMultipliers);
      const display = previewUiCopy(uiLanguage).seconds(seconds);
      playlistTimeoutInputs[stage].value = String(seconds);
      playlistTimeoutInputs[stage].setAttribute("aria-valuetext", display);
      playlistTimeoutValues[stage].value = display;
    }
  }
  let playlistTimeoutPreferenceChanged = false;
  for (const stage of ["starting", "ready", "request"] as const) {
    playlistTimeoutInputs[stage].oninput = () => {
      playlistTimeoutPreferenceChanged = true;
      applyPlaylistBrokerTimeoutMultipliers({ ...playlistBrokerTimeoutMultipliers,
        [stage]: playlistBrokerTimeoutMultiplierForSeconds(stage, playlistTimeoutInputs[stage].value) });
    };
    playlistTimeoutInputs[stage].onchange = () => {
      playlistTimeoutPreferenceChanged = true;
      applyPlaylistBrokerTimeoutMultipliers({ ...playlistBrokerTimeoutMultipliers,
        [stage]: playlistBrokerTimeoutMultiplierForSeconds(stage, playlistTimeoutInputs[stage].value) });
      void savePlaylistBrokerTimeoutMultipliers(chrome.storage.local, playlistBrokerTimeoutMultipliersKey,
        playlistBrokerTimeoutMultipliers);
      record(`Playlist ${stage} timeout set to ${previewUiCopy(uiLanguage).seconds(
        playlistBrokerTimeoutSeconds(stage, playlistBrokerTimeoutMultipliers))}`);
    };
  }
  applyPlaylistBrokerTimeoutMultipliers(playlistBrokerTimeoutMultipliers);
  void loadPlaylistBrokerTimeoutMultipliers(chrome.storage.local, playlistBrokerTimeoutMultipliersKey).then(
    value => { if (!playlistTimeoutPreferenceChanged) applyPlaylistBrokerTimeoutMultipliers(value); },
    () => { if (!playlistTimeoutPreferenceChanged) applyPlaylistBrokerTimeoutMultipliers(defaultPlaylistBrokerTimeoutMultipliers); },
  );
  function applyPlaylistAutoplay(value: boolean) {
    playlistAutoplay = value;
    const label = previewUiCopy(uiLanguage).autoplayNext(value);
    playlistAutoplayButton.setAttribute("aria-pressed", String(value));
    playlistAutoplayButton.setAttribute("aria-label", label);
    playlistAutoplayButton.dataset.tooltip = label;
  }
  function togglePlaylistAutoplay() {
    applyPlaylistAutoplay(!playlistAutoplay);
    void savePlaylistAutoplayPreference(chrome.storage.local, playlistAutoplayKey, playlistAutoplay);
    record(`Playlist autoplay ${playlistAutoplay ? "enabled" : "disabled"}`);
  }
  let playlistAutoplayPreferenceChanged = false;
  playlistAutoplayButton.onclick = () => {
    playlistAutoplayPreferenceChanged = true;
    previewSession.dispatch({ type: "control", action: "toggle-playlist-autoplay" });
  };
  void loadPlaylistAutoplayPreference(chrome.storage.local, playlistAutoplayKey).then(
    value => { if (!playlistAutoplayPreferenceChanged) applyPlaylistAutoplay(value); },
    () => { if (!playlistAutoplayPreferenceChanged) applyPlaylistAutoplay(defaultPlaylistAutoplayEnabled); },
  );
  function applyLogAutoSave(value: boolean) {
    if (!value && autoSaveLogs) scrollDiagnostics.flush(playlistScrollSnapshot());
    autoSaveLogs = value;
    logAutoSaveInput.checked = value;
    downloadLogButton.disabled = value;
    diagnosticSession.setAutoSave(value);
    element("debug-log-status").textContent = value
      ? previewUiCopy(uiLanguage).autoSaveLogsOn
      : previewUiCopy(uiLanguage).autoSaveLogsOff;
    diagnosticSession.record(value ? "logging.auto-save-enabled" : "logging.auto-save-disabled", { version: prototypeVersion });
  }
  let logAutoSavePreferenceChanged = false;
  logAutoSaveInput.onchange = () => {
    logAutoSavePreferenceChanged = true;
    applyLogAutoSave(logAutoSaveInput.checked);
    void savePreviewLogAutoSavePreference(chrome.storage.local, logAutoSaveKey, logAutoSaveInput.checked);
  };
  void loadPreviewLogAutoSavePreference(chrome.storage.local, logAutoSaveKey).then(
    value => { if (!logAutoSavePreferenceChanged) applyLogAutoSave(value); },
    () => { if (!logAutoSavePreferenceChanged) applyLogAutoSave(defaultPreviewLogAutoSaveEnabled); },
  );
  element("release").onclick = () => previewSession.dispatch({ type: "close", reason: "release-button" });
  element("play").onclick = () => { previewSession.dispatch({ type: "control", action: "toggle-play" }); };
  element("captions").onclick = () => previewSession.dispatch({ type: "control", action: "toggle-captions" });
  function selectCaptionLanguage(track: string) {
    if (!session) return;
    refreshCaptions(true, track);
    record(`Subtitle language selected: ${captionState?.tracks.find(t => t.id === track)?.label ?? track}`);
  }
  element("caption-language").onchange = () => previewSession.dispatch({ type: "control", action: "select-caption-language", value: element<HTMLSelectElement>("caption-language").value });
  function selectCaptionTranslation(translation: string) {
    if (!session) return;
    refreshCaptions(true, undefined, translation);
    record("Subtitle translation selected");
  }
  element("caption-translation").onchange = () => previewSession.dispatch({ type: "control", action: "select-caption-translation", value: element<HTMLSelectElement>("caption-translation").value });
  element("fullscreen").onclick = () => previewSession.dispatch({ type: "control", action: "toggle-fullscreen" });
  element("speaker").onclick = () => previewSession.dispatch({ type: "control", action: "toggle-mute" });
  element("progress").oninput = () => previewSession.dispatch({ type: "control", action: "seek-to", value: Number(element<HTMLInputElement>("progress").value) });
  element("progress").onpointerdown = () => { scrubbing = true; showProgress(); };
  for (const name of ["pointerup", "pointercancel"]) window.addEventListener(name, () => {
    if (scrubbing) {
      scrubbing = false;
      element<HTMLInputElement>("progress").blur();
      showProgress();
    }
  }, true);
  element("speed").onchange = () => previewSession.dispatch({ type: "control", action: "set-speed", value: Number(element<HTMLSelectElement>("speed").value) });
  function requestQuality(choice: string, startup = false) {
    if (!session) return;
    const active = session;
    const videoId = watchId(active.host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href);
    if (!videoId || active.qualityChange) return;
    active.fullscreenRestore = null;
    // The native quality setter can synchronously empty/reload MediaSource.
    // Arm recovery BEFORE calling it, scoped to this video and watch identity.
    active.qualityChange = { until: performance.now() + 15000, videoId,
      time: active.video.currentTime, muted: active.video.muted, volume: active.video.volume, rate: active.video.playbackRate,
      quality: choice, startup };
    refreshQuality(choice);
    if (qualityChoice?.owner !== active || qualityChoice.value !== choice || qualityState?.error) active.qualityChange = null;
    record(`Requested preview quality: ${qualityLabels[choice] ?? choice}`);
  }
  function selectQuality(choice: string) {
    if (session) session.defaultQualityApplied = true;
    requestQuality(choice);
  }
  element("quality").onchange = () => previewSession.dispatch({ type: "control", action: "select-quality", value: element<HTMLSelectElement>("quality").value });
  function applyPreviewStartupSettings(timeout: unknown, attempts: unknown, persist = false) {
    previewStartupTimeoutSeconds = normalizePreviewStartupTimeoutSeconds(timeout);
    previewStartupAttempts = normalizePreviewStartupAttempts(attempts);
    const copy = previewUiCopy(uiLanguage);
    previewStartupTimeoutInput.value = String(previewStartupTimeoutSeconds);
    previewStartupTimeoutInput.setAttribute("aria-valuetext", copy.seconds(previewStartupTimeoutSeconds));
    previewStartupTimeoutValue.value = copy.seconds(previewStartupTimeoutSeconds);
    applySettingsChoice(previewStartupAttemptsControl, previewStartupAttempts);
    if (persist) {
      void chrome.storage.local.set({
        [previewStartupTimeoutKey]: previewStartupTimeoutSeconds,
        [previewStartupAttemptsKey]: previewStartupAttempts,
      });
      record(`Preview startup set to ${previewStartupTimeoutSeconds}s × ${previewStartupAttempts} attempts`);
    }
  }
  let previewStartupPreferenceChanged = false;
  previewStartupTimeoutInput.oninput = () => {
    previewStartupPreferenceChanged = true;
    applyPreviewStartupSettings(previewStartupTimeoutInput.value, settingsChoiceValue(previewStartupAttemptsControl));
  };
  previewStartupAttemptsControl.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-value]") : null;
    if (!button || !previewStartupAttemptsControl.contains(button)) return;
    previewStartupPreferenceChanged = true;
    applyPreviewStartupSettings(previewStartupTimeoutInput.value, Number(button.dataset.value), true);
  });
  const persistPreviewStartupSettings = () => {
    previewStartupPreferenceChanged = true;
    applyPreviewStartupSettings(previewStartupTimeoutInput.value, settingsChoiceValue(previewStartupAttemptsControl), true);
  };
  previewStartupTimeoutInput.onchange = persistPreviewStartupSettings;
  void chrome.storage.local.get([previewStartupTimeoutKey, previewStartupAttemptsKey]).then(values => {
    if (!previewStartupPreferenceChanged) applyPreviewStartupSettings(values[previewStartupTimeoutKey], values[previewStartupAttemptsKey]);
  }, () => {
    if (!previewStartupPreferenceChanged) applyPreviewStartupSettings(defaultPreviewStartupTimeoutSeconds, defaultPreviewStartupAttempts);
  });
  restoreDefaultsButton.onclick = () => {
    enabledPreferenceChanged = true;
    playlistRetentionPreferenceChanged = true;
    playlistStageRetryPreferenceChanged = true;
    playlistTimeoutPreferenceChanged = true;
    playlistAutoplayPreferenceChanged = true;
    logAutoSavePreferenceChanged = true;
    previewStartupPreferenceChanged = true;
    uiLanguagePreferenceChanged = true;
    applyUiLanguage(defaultPreviewUiLanguage);
    applyEnabledPreference(true);
    searchPreference.receive(defaultPreviewUrlSearchEnabled);
    applyPlaylistRetentionCapacity(defaultPlaylistPreviewRetentionCapacity);
    applyPlaylistStageRetryLimit(defaultPlaylistStageRetryLimit);
    applyPlaylistBrokerTimeoutMultipliers(defaultPlaylistBrokerTimeoutMultipliers);
    applyPlaylistAutoplay(defaultPlaylistAutoplayEnabled);
    applyLogAutoSave(defaultPreviewLogAutoSaveEnabled);
    applyPreviewStartupSettings(defaultPreviewStartupTimeoutSeconds, defaultPreviewStartupAttempts);
    restoreDefaultsButton.disabled = true;
    void chrome.storage.local.set({
      [enabledKey]: true,
      [previewUrlSearchKey]: defaultPreviewUrlSearchEnabled,
      [playlistPreviewRetentionCapacityKey]: defaultPlaylistPreviewRetentionCapacity,
      [playlistStageRetryLimitKey]: defaultPlaylistStageRetryLimit,
      [playlistBrokerTimeoutMultipliersKey]: defaultPlaylistBrokerTimeoutMultipliers,
      [playlistAutoplayKey]: defaultPlaylistAutoplayEnabled,
      [logAutoSaveKey]: defaultPreviewLogAutoSaveEnabled,
      [previewStartupTimeoutKey]: defaultPreviewStartupTimeoutSeconds,
      [previewStartupAttemptsKey]: defaultPreviewStartupAttempts,
      [uiLanguageKey]: defaultPreviewUiLanguage,
    }).then(() => record("All Playmium settings restored to defaults"), () => {
      element("message").textContent = previewUiCopy(uiLanguage).settingsRestoredSaveFailed;
    }).finally(() => { restoreDefaultsButton.disabled = false; });
  };
  function applyDefaultQuality(): boolean {
    if (!session || session.defaultQualityApplied || session.qualityChange || !qualityState?.supported) return false;
    const choice = preferredQuality(qualityState.available);
    if (!choice) return false;
    session.defaultQualityApplied = true;
    if (qualityState.current === choice) return false;
    requestQuality(choice, session.startupQualityPending);
    return Boolean(session.qualityChange);
  }
  function setVolume(value: number, feedback = false) {
    if (session) {
      session.video.volume = Math.min(1, Math.max(0, value));
      if (typeof CustomEvent === "function") session.video.dispatchEvent(new CustomEvent(playlistAudioChangeEvent));
      if (session.qualityChange) session.qualityChange.volume = session.video.volume;
      if (session.fullscreenRestore) session.fullscreenRestore.volume = session.video.volume;
      if (session.startupRestore) session.startupRestore.volume = session.video.volume;
      if (feedback) showVolumeFeedback();
      record("Volume requested");
    }
  }
  element("volume").oninput = () => previewSession.dispatch({ type: "control", action: "set-volume", value: Number(element<HTMLInputElement>("volume").value) });
  for (const [id, answer] of [["heard", "User hears audio"], ["silent", "User reports silence"]]) {
    element(id).onclick = () => { heard = answer; record(answer); };
  }
  element("collapse").title = previewUiCopy(uiLanguage).hideShowControlsShortcut;
  element("collapse").setAttribute("aria-controls", "controls");
  type ControlTab = "youtube" | "playmium";
  let selectedControlTab: ControlTab = "youtube";
  function selectControlTab(tab: ControlTab, focus = false) {
    selectedControlTab = tab;
    if (tab !== "playmium") setAdvancedSettingsOpen(false, false);
    const youtubeSelected = tab === "youtube";
    youtubeControlsTab.setAttribute("aria-selected", String(youtubeSelected));
    youtubeControlsTab.tabIndex = youtubeSelected ? 0 : -1;
    playmiumTab.setAttribute("aria-selected", String(!youtubeSelected));
    playmiumTab.tabIndex = youtubeSelected ? -1 : 0;
    element("youtube-panel").hidden = !youtubeSelected;
    element("playmium-panel").hidden = youtubeSelected;
    selectControls.close();
    if (focus) (youtubeSelected ? youtubeControlsTab : playmiumTab).focus({ preventScroll: true });
  }
  youtubeControlsTab.onclick = () => selectControlTab("youtube", true);
  playmiumTab.onclick = () => selectControlTab("playmium", true);
  for (const tab of [youtubeControlsTab, playmiumTab]) tab.onkeydown = event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    selectControlTab(selectedControlTab === "youtube" ? "playmium" : "youtube", true);
  };
  type ControlPage = "settings" | "chapters" | "info" | "playlist";
  function closeControlPages(except?: ControlPage) {
    if (except !== "settings") {
      element("controls").hidden = true;
      element("settings").setAttribute("aria-expanded", "false");
      element("collapse").setAttribute("aria-expanded", "false");
      selectControls.close();
    }
    if (except !== "chapters") {
      chapterPanel.hidden = true;
      chapterButton.setAttribute("aria-expanded", "false");
    }
    if (except !== "info") hideInfoViewer();
    if (except !== "playlist" && typeof setPlaylistExpanded === "function") setPlaylistExpanded(false);
  }
  function openControlPanel(tab = selectedControlTab) {
    hideInfoViewer();
    const controls = element("controls");
    closeControlPages("settings");
    controls.hidden = false;
    selectControlTab(tab);
    element("settings").setAttribute("aria-expanded", "true");
    element("collapse").setAttribute("aria-expanded", "true");
    panel.hidden = false;
    if (tab === "youtube" && session) selectControls.focus("caption-language");
    else element("enable").focus({ preventScroll: true });
    showProgress();
  }
  function togglePanel(tab: ControlTab = "youtube") {
    const controls = element("controls");
    if (controls.hidden) openControlPanel(tab);
    else {
      closeControlPages();
      panel.tabIndex = -1;
      panel.focus({ preventScroll: true });
    }
    showProgress();
  }
  element("collapse").onclick = () => previewSession.dispatch({ type: "control", action: "toggle-settings" });
  element("settings").onclick = () => previewSession.dispatch({ type: "control", action: "toggle-settings", value: "youtube" });
  chrome.runtime.onMessage.addListener((command: unknown) => {
    const message = command as { kind?: unknown; tab?: unknown };
    if (message?.kind !== "open-inline-preview-control-panel" || message.tab !== "playmium") return;
    openControlPanel("playmium");
  });
  function toggleChapters() {
    const opening = chapterPanel.hidden;
    if (opening) closeControlPages("chapters"); else closeControlPages();
    chapterPanel.hidden = !opening;
    sidePanelTab = opening ? "chapters" : null;
    chapterSideTab.setAttribute("aria-selected", String(sidePanelTab === "chapters"));
    playlistSideTab.setAttribute("aria-selected", "false");
    playlistSurface.dataset.activeTab = sidePanelTab ?? "";
    playlistSurface.dataset.expanded = String(opening);
    playlistRevealed = false;
    playlistSurface.dataset.revealed = "false";
    chapterButton.setAttribute("aria-expanded", String(opening)); showProgress();
  }
  chapterButton.onclick = () => previewSession.dispatch({ type: "control", action: "toggle-chapters" });
  chapterPanel.querySelector<HTMLButtonElement>("#close-chapters")!.onclick = () => { chapterPanel.hidden = true; sidePanelTab = null; playlistSurface.dataset.activeTab = ""; playlistSurface.dataset.expanded = "false"; chapterSideTab.setAttribute("aria-selected", "false"); chapterButton.setAttribute("aria-expanded", "false"); chapterButton.focus(); };
  function toggleInfo() {
    const opening = !infoViewer.isOpen();
    if (opening) { closeControlPages("info"); infoViewer.toggle(); } else closeControlPages();
    infoButton.setAttribute("aria-expanded", String(infoViewer.isOpen())); showProgress();
  }
  infoButton.onclick = () => previewSession.dispatch({ type: "control", action: "toggle-info" });
  function hideSettings() {
    element("controls").hidden = true;
    chapterPanel.hidden = true;
    element("settings").setAttribute("aria-expanded", "false");
    chapterButton.setAttribute("aria-expanded", "false");
    selectControls.close();
  }
  function hideInfoViewer() {
    infoViewer.hide();
    infoButton.setAttribute("aria-expanded", "false");
  }
  function hideOverlays() {
    closeControlPages();
  }
  function overlaysOpen() {
    return !element("controls").hidden || !chapterPanel.hidden || infoViewer.isOpen() ||
      typeof playlistExpanded !== "undefined" && playlistExpanded;
  }
  shadow.addEventListener("click", event => {
    const path = event.composedPath();
    if (session && typeof playlistExpanded !== "undefined" && playlistExpanded && !path.includes(playlistButton)) setPlaylistExpanded(false);
    if (session && !path.includes(element("controls")) && !path.includes(advancedSettingsView) && !path.includes(element("settings")) &&
        !path.includes(element("preview-select-menu")) && !path.includes(chapterPanel) && !path.includes(chapterButton)) hideSettings();
    if (session && !path.includes(infoViewer.root) && !path.includes(infoButton)) hideInfoViewer();
    infoButton.setAttribute("aria-expanded", String(infoViewer.isOpen()));
  });
  window.addEventListener("pointerdown", event => {
    if (!session?.floating || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        document.fullscreenElement === session.host || event.composedPath().includes(panel) ||
        (event.composedPath?.() ?? []).some(target => (target as HTMLElement)?.id === "skip-ads-preview-playlist") ||
        !(event.target instanceof Node) || !session.host.contains(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    dragging = { owner: session, pointerId: event.pointerId, x: event.clientX, y: event.clientY, rect: { ...session.floating }, moved: false };
    session.host.setPointerCapture(event.pointerId);
    showProgress();
  }, true);
  window.addEventListener("dragstart", event => {
    if (dragging) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener("pointermove", event => {
    if (!dragging || session !== dragging.owner || event.pointerId !== dragging.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
    dragging.moved ||= Math.hypot(dx, dy) > 4;
    if (!dragging.moved) return;
    hideOverlays();
    session.floating = { ...dragging.rect, left: dragging.rect.left + dx, top: dragging.rect.top + dy };
    positionPlayer();
  }, true);
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) window.addEventListener(name, event => {
    if (!dragging || (event as PointerEvent).pointerId !== dragging.pointerId) return;
    if (dragging.moved) suppressDragClickUntil = performance.now() + 500;
    dragging = null;
    showProgress();
  }, true);
  element("export").onclick = () => {
    record("Downloaded current diagnostics session");
    const report = diagnosticSession.exportCurrent();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `inline-preview-v${prototypeVersion}-${report.session.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // Install early, before hover handlers. Pinning keeps the original player in
  // place and suppresses pointer-leave teardown only during this experiment.
  for (const name of ["blur", "visibilitychange"]) {
    window.addEventListener(name, event => {
      // A pinned video is explicitly selected for viewing. Prevent YouTube's
      // window/tab background handlers from pausing or dismantling that video.
      // Do not suppress field blur, alter visibility properties, or call play:
      // the user's manual pause remains authoritative across focus changes.
      if (!session || !supportedPage() || (name === "blur" && event.target !== window)) return;
      event.stopImmediatePropagation();
      record(`Kept pinned preview on ${name}`);
    }, true);
  }
  window.addEventListener("yt-action", event => {
    // Real headed Chrome can refresh the originating thumbnail when entering
    // fullscreen. YouTube then sends this action to tear down its hover player.
    // Keep the explicitly pinned preview; navigation and Release still end it.
    if ((session || pendingPin) && supportedPage() && (event as CustomEvent<{ actionName?: string }>).detail?.actionName === "yt-terminate-video-preview-action") {
      event.stopImmediatePropagation();
      record("Kept pinned preview during thumbnail teardown action");
    }
  }, true);
  window.addEventListener("volumechange", event => {
    // Some music previews have audio but omit the native sound toggle. Their
    // player listens to volumechange and immediately forces the video muted,
    // even after its public unmute control reports success. Preserve only an
    // explicit unmute of this pinned video in that observed control variant.
    // Release removes the session, restoring normal event handling and mute.
    if (session && supportedPage() && event.target === session.video && session.requestedMuted === false &&
        !session.video.muted && !session.host.querySelector(".ytmMuteButtonButton, .ytp-mute-button")) {
      event.stopImmediatePropagation();
      session.preservedUnmuteEvents++;
      record("Preserved requested unmute on preview without native sound toggle");
    }
  }, true);
  function queuePlaylistAutoplay(): "warm" | "cold" | null {
    const active = session;
    const videoId = nextPlaylistAutoplayVideoId(playlist);
    if (!playlistAutoplay || !active?.playlistContext || !videoId || pendingPlaylistSelection) return null;
    const preparation = playlistAutoplayPreparation(
      playlistPreviewStates.get(videoId),
      playlistPreviewActions.get(videoId),
    );
    playlistHoverIntent.cancel();
    cancelPlaylistPrime(`autoplay-${preparation.mode}-selection`);
    const pendingActionId = playlistPreviewActions.get(videoId);
    if (preparation.mode === "cold" && pendingActionId) {
      active.video.dispatchEvent(new CustomEvent(playlistPrefetchCancelEvent, { bubbles: true, detail: JSON.stringify({
        actionId: pendingActionId, videoId, playlistId: active.playlistContext.playlistId, reason: "autoplay-cold-selection",
      }) }));
      playlistPreviewActions.delete(videoId);
      playlistPreviewStates.delete(videoId);
    }
    const row = playlistList.querySelector<HTMLElement>(`.playlist-item[data-video-id="${CSS.escape(videoId)}"]`);
    const measured = row?.getBoundingClientRect() ?? active.host.getBoundingClientRect();
    const rect = { left: measured.left, top: measured.top, width: measured.width, height: measured.height };
    emitPreviewDebugLog("preview.click", {
      surface: "playlist", trigger: "autoplay", videoId, actionId: preparation.actionId,
      cold: preparation.mode === "cold", warm: preparation.mode === "warm",
    });
    queueMicrotask(() => {
      if (session === active && active.video.ended && playlistAutoplay) {
        previewSession.dispatch({ type: "playlist", action: "select", videoId, actionId: preparation.actionId, rect });
      }
    });
    return preparation.mode;
  }
  window.addEventListener("ended", event => {
    // A completed hover preview hides its player and can immediately pause a
    // replay. The real short-video probe recovered replay by retaining this
    // event while pinned. The media element still reaches its real ended state.
    if (session && supportedPage() && event.target === session.video) {
      event.stopImmediatePropagation();
      const autoplayMode = queuePlaylistAutoplay();
      if (autoplayMode) {
        message = "Video ended. Starting the next playlist video…";
        record(`Playlist autoplay queued a ${autoplayMode} selection of the next video`);
        return;
      }
      message = "Video ended. Press K or Play / pause to replay.";
      record("Preview reached its natural end; retained for replay");
    }
  }, true);
  for (const name of ["mouseout", "mouseleave", "pointerout", "pointerleave", "mouseover", "mouseenter", "pointerover", "pointerenter", "mousemove", "pointermove"]) {
    window.addEventListener(name, event => {
      const activeHost = session?.host ?? loading?.host;
      if (nativeAction || !activeHost || !supportedPage() || !(event.target instanceof Node)) return;
      // The shared native hover player must not be reassigned to a background
      // thumbnail. The transparent backdrop also prevents CSS hover/click-through.
      const selected = loading && (loading.target.closest("ytd-thumbnail, yt-thumbnail-view-model") ?? loading.target);
      const playlistEvent = (event.composedPath?.() ?? []).some(target => (target as HTMLElement)?.id === "skip-ads-preview-playlist");
      if (!playlistEvent && (!activeHost.contains(event.target) && !selected?.contains(event.target) || ["mouseout", "mouseleave", "pointerout", "pointerleave"].includes(name))) event.stopImmediatePropagation();
    }, true);
  }
  function animatePlayer(host: HTMLElement, opening: boolean, start?: Keyframe) {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    // Individual transforms and filter opacity animate despite the native
    // hover player's pinned transform/opacity overrides. Hold the final frame
    // until release so closing cannot flash back to full visibility.
    const spec = previewAnimationSpec(opening, start);
    return host.animate(spec.frames, spec.options);
  }
  function closePreview() {
    if (!session && loading) {
      const active = loading;
      if (active.closing) return;
      active.closing = true; pendingPin = null;
      active.host.dispatchEvent(new CustomEvent(sharedPreviewCancelEvent));
      const current = getComputedStyle(active.host);
      const start = { scale: current.scale, translate: current.translate, filter: current.filter };
      active.animation?.cancel();
      active.animation = animatePlayer(active.host, false, start);
      const finish = () => { if (loading === active) { discardLoading(); render(); } };
      if (active.animation) void active.animation.finished.then(finish, finish); else finish();
      return;
    }
    const active = session;
    if (!active || active.closing) return;
    active.closing = true;
    const current = getComputedStyle(active.host);
    const start = { scale: current.scale, translate: current.translate, filter: current.filter };
    active.animation?.cancel();
    const animation = animatePlayer(active.host, false, start);
    active.animation = animation;
    const finish = () => { if (session === active) release("Exited preview."); };
    if (animation) void animation.finished.then(finish, finish); else finish();
  }
  resizeHandles.addEventListener("pointerdown", event => {
    const target = event.target as HTMLElement;
    if (!session?.floating || session.closing || document.fullscreenElement === session.host || event.button !== 0 || !target.dataset.edge) return;
    event.preventDefault(); event.stopPropagation();
    resizing = { owner: session, pointerId: event.pointerId, edge: target.dataset.edge, x: event.clientX, y: event.clientY, rect: { ...session.floating } };
    target.setPointerCapture(event.pointerId);
    hideOverlays();
  });
  // A zero-gap drawer visually reaches the player edge. Preserve the native
  // seven-pixel resize affordance by routing that exact strip back to resizing.
  playlistResizeProxy.addEventListener("pointerdown", event => {
    if (!session?.floating || session.closing || document.fullscreenElement === session.host || event.button !== 0) return;
    const rect = session.host.getBoundingClientRect();
    const corner = Math.min(18, rect.height * .15);
    const edge = event.clientY <= rect.top + corner ? "ne" : event.clientY >= rect.bottom - corner ? "se" : "e";
    event.preventDefault(); event.stopImmediatePropagation();
    resizing = { owner: session, pointerId: event.pointerId, edge, x: event.clientX, y: event.clientY, rect: { ...session.floating } };
    playlistResizeProxy.setPointerCapture(event.pointerId);
    hideOverlays();
  });
  window.addEventListener("pointermove", event => {
    if (!resizing || session !== resizing.owner || event.pointerId !== resizing.pointerId) return;
    event.preventDefault(); event.stopImmediatePropagation();
    session.floating = resizeRect(resizing.rect, resizing.edge, event.clientX - resizing.x, event.clientY - resizing.y, innerWidth, innerHeight, session.aspectRatio);
    positionPlayer(); showProgress();
  }, true);
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) window.addEventListener(name, event => {
    if (resizing && (event as PointerEvent).pointerId === resizing.pointerId) { resizing = null; suppressDragClickUntil = performance.now() + 500; }
  }, true);
  for (const name of ["pointerdown", "mousedown", "pointerup", "mouseup", "contextmenu", "auxclick"]) {
    window.addEventListener(name, event => {
      const activeHost = session?.host ?? loading?.host;
      if (!activeHost || !supportedPage() || !(event.target instanceof Node) || activeHost.contains(event.target) ||
          (event.composedPath?.() ?? []).some(target => (target as HTMLElement)?.id === "skip-ads-preview-playlist")) return;
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, passive: false });
  }
  window.addEventListener("wheel", event => {
    const activeHost = session?.host ?? loading?.host;
    if (!activeHost || !supportedPage() || event.ctrlKey || !(event.target instanceof Node)) return;
    const path = event.composedPath();
    if (path.includes(playlistChrome)) return;
    if (!activeHost.contains(event.target) && !path.includes(panel)) {
      event.stopImmediatePropagation();
      return;
    }
    // Stop YouTube's delegated gestures, but keep native scrolling within an
    // actual scrollable overlay. At its boundary (or over video), consume the
    // default action so wheel input cannot chain into the background document.
    const canScroll = path.some(node => {
      if (!(node instanceof HTMLElement) || node === activeHost) return false;
      const style = getComputedStyle(node);
      return /auto|scroll/.test(style.overflowY) &&
          (event.deltaY < 0 && node.scrollTop > 0 || event.deltaY > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) ||
        /auto|scroll/.test(style.overflowX) &&
          (event.deltaX < 0 && node.scrollLeft > 0 || event.deltaX > 0 && node.scrollLeft + node.clientWidth < node.scrollWidth - 1);
    });
    if (!canScroll) event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, passive: false });
  for (const name of ["touchstart", "touchmove"]) window.addEventListener(name, event => {
    if (session && supportedPage() && event.target instanceof Node && !session.host.contains(event.target) &&
        !(event.composedPath?.() ?? []).some(target => (target as HTMLElement)?.id === "skip-ads-preview-playlist")) event.stopImmediatePropagation();
  }, { capture: true, passive: true });
  let lastDebugHover = "";
  let lastDebugHoverAt = 0;
  type ThumbnailIntent = { target: HTMLElement; videoId: string; requestId: string; phase: string };
  const thumbnailPreparations = new WeakMap<Element, ThumbnailIntent>();
  let thumbnailIntent: ThumbnailIntent | null = null;
  let thumbnailSequence = 0;
  const thumbnailHover = createPlaylistHoverIntent({ schedule: (action, ms) => setTimeout(action, ms), cancel: timer => clearTimeout(timer as number) });
  function thumbnailState(target: HTMLElement, videoId: string, phase: string) {
    const entry = resolvePreviewThumbnail(target, location.href);
    const owner = entry?.target as HTMLElement | undefined;
    if (!owner) return;
    let badge = owner.querySelector<HTMLElement>(":scope > .skip-ads-thumbnail-preview-state");
    if (previewPlaybackSupport(owner, videoId, location.pathname).native) { badge?.remove(); return; }
    if (!badge) {
      badge = document.createElement("small"); badge.className = "skip-ads-thumbnail-preview-state"; badge.setAttribute("role", "status");
      badge.style.cssText = "position:absolute;left:8px;bottom:8px;z-index:5;padding:4px 7px;background:#101820e8;color:#dcece9;border-radius:5px;font:12px system-ui;pointer-events:none";
      if (getComputedStyle(owner).position === "static") owner.style.position = "relative";
      owner.append(badge);
    }
    if (entry?.surface === "notification") {
      badge.style.left = "4px";
      badge.style.bottom = "4px";
      badge.style.padding = "2px 4px";
      badge.style.fontSize = "10px";
      badge.style.maxWidth = "calc(100% - 8px)";
      badge.style.overflow = "hidden";
      badge.style.textOverflow = "ellipsis";
      badge.style.whiteSpace = "nowrap";
    }
    badge.dataset.previewState = phase;
    badge.style.color = phase === "preparing" ? "#f1c75b" :
      phase === "ready" ? "#5eead4" : "#dcece9";
    const copy = previewUiCopy(uiLanguage); badge.textContent = ({ idle: copy.hoverToPrepare, preparing: copy.preparingPreview, ready: copy.previewReady, error: copy.tryAgain, playing: copy.previewPlaying } as Record<string, string>)[phase] ?? phase;
  }
  function leaveThumbnail() {
    thumbnailHover.cancel();
    const intent = thumbnailIntent; thumbnailIntent = null;
    if (!intent || intent.phase === "ready") return;
    intent.target.dispatchEvent(new CustomEvent(sharedPreviewCancelEvent, { detail: JSON.stringify(intent) }));
    thumbnailPreparations.delete(intent.target); thumbnailState(intent.target, intent.videoId, "idle");
  }
  function enterThumbnail(event: Event) {
    if (!enabled || session || loading || !(event.target instanceof Element)) return;
    const entry = resolvePreviewThumbnail(event.target, location.href);
    if (!entry || previewPlaybackSupport(entry.target, entry.videoId, location.pathname).native) return;
    if (thumbnailIntent?.target === entry.target && thumbnailIntent.videoId === entry.videoId) return;
    leaveThumbnail();
    const intent = thumbnailPreparations.get(entry.target) ?? { target: entry.target as HTMLElement, videoId: entry.videoId,
      requestId: `thumbnail-${Date.now()}-${++thumbnailSequence}`, phase: "idle" };
    thumbnailIntent = intent;
    if (intent.phase === "ready") return;
    thumbnailHover.enter(intent.videoId, () => {
      if (thumbnailIntent !== intent || !intent.target.isConnected || session || loading) return;
      thumbnailPreparations.set(intent.target, intent); intent.phase = "preparing";
      emitPreviewDebugLog("preview.prepare-intent", { surface: "thumbnail", videoId: intent.videoId, actionId: intent.requestId });
      intent.target.dispatchEvent(new CustomEvent(sharedPreviewPrepareEvent, { detail: JSON.stringify({ ...intent,
        trigger: event.type === "focusin" ? "focus" : "hover",
        retentionCapacity: playlistPreviewRetentionCapacity, retryLimit: playlistStageRetryLimit, timeoutMultipliers: playlistBrokerTimeoutMultipliers }) }));
    });
  }
  function exitThumbnail(event: Event) {
    if (!thumbnailIntent || !(event.target instanceof Node) || !thumbnailIntent.target.contains(event.target)) return;
    const related = (event as MouseEvent).relatedTarget;
    if (related instanceof Node && thumbnailIntent.target.contains(related)) return;
    leaveThumbnail();
  }
  window.addEventListener("pointerover", enterThumbnail, { capture: true, passive: true });
  window.addEventListener("focusin", enterThumbnail, { capture: true, passive: true });
  window.addEventListener("pointerout", exitThumbnail, { capture: true, passive: true });
  window.addEventListener("focusout", exitThumbnail, { capture: true, passive: true });
  document.addEventListener(playlistPreviewWarmPhaseEvent, event => {
    const intent = event.target instanceof Element ? thumbnailPreparations.get(event.target) : undefined;
    if (!intent) return;
    let phase: { actionId?: string; videoId?: string; phase?: string };
    try { phase = JSON.parse((event as CustomEvent).detail); } catch { return; }
    if (phase.actionId !== intent.requestId || phase.videoId !== intent.videoId || !phase.phase) return;
    intent.phase = phase.phase; thumbnailState(intent.target, intent.videoId, intent.phase);
  }, true);
  const statusObserver = new MutationObserver(records => {
    for (const record of records) for (const added of record.addedNodes) {
      if (!(added instanceof Element) || added.closest(".skip-ads-thumbnail-preview-state,[data-skip-preview-owned]")) continue;
      const candidates = [...added.querySelectorAll(previewThumbnailSelector)];
      if (added.matches(previewThumbnailSelector)) candidates.push(added);
      for (const target of candidates) { const entry = resolvePreviewThumbnail(target, location.href);
        if (entry && !entry.target.querySelector(":scope > .skip-ads-thumbnail-preview-state")) thumbnailState(entry.target as HTMLElement, entry.videoId, "idle"); }
    }
  });
  statusObserver.observe(document, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => { leaveThumbnail(); statusObserver.disconnect(); }, { once: true });

  window.addEventListener("pointerover", event => {
    if (!previewDebugLoggingEnabled() || nativeAction || !enabled || session || !supportedPage() || event.pointerType === "touch" ||
        !(event.target instanceof Element) || event.target.closest(shortsSelector)) return;
    const thumbnail = event.target.closest("ytd-thumbnail, yt-thumbnail-view-model");
    if (!thumbnail) return;
    const videoId = watchId(previewWatchHref(thumbnail));
    const now = performance.now();
    if (!videoId || videoId === lastDebugHover && now - lastDebugHoverAt < 1000) return;
    lastDebugHover = videoId;
    lastDebugHoverAt = now;
    emitPreviewDebugLog("preview.hover", { surface: "thumbnail", videoId });
  }, { capture: true, passive: true });
  window.addEventListener("click", event => {
    if (!supportedPage()) return;
    if (session && event.detail !== 0 && performance.now() < suppressDragClickUntil) {
      suppressDragClickUntil = 0;
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (nativeAction || event.composedPath().includes(panel) ||
        (event.composedPath?.() ?? []).some(target => (target as HTMLElement)?.id === "skip-ads-preview-playlist")) return;
    const currentHost = session?.host ?? loading?.host;
    if (currentHost?.hasAttribute("data-skip-preview-owned") && !session?.closing && !loading?.closing &&
        event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        event.target instanceof Element && !currentHost.contains(event.target)) {
      const entry = resolvePreviewThumbnail(event.target, location.href);
      const bounds = loading?.floating;
      const insideLoading = bounds && event.clientX >= bounds.left && event.clientX <= bounds.left + bounds.width &&
        event.clientY >= bounds.top && event.clientY <= bounds.top + bounds.height;
      if (entry && !insideLoading && !previewPlaybackSupport(entry.target, entry.videoId, location.pathname).native) {
        event.preventDefault(); event.stopImmediatePropagation();
        previewSession.dispatch({ type: "activate", videoId: entry.videoId, target: entry.target }); return;
      }
    }
    if (session?.closing && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        event.target instanceof Element && !event.target.closest(shortsSelector) &&
        event.target.closest(`${previewSelector}, ytd-thumbnail, yt-thumbnail-view-model`) &&
        !event.target.closest("button,[role=button],input,select,[role=slider]")) {
      const target = event.target;
      const videoId = watchId(previewWatchHref(target));
      if (videoId) {
        // A closing animation keeps the old session alive briefly. Replace it
        // synchronously so a valid thumbnail click in that window is not lost.
        release("A new preview replaced the closing player.");
        event.preventDefault(); event.stopImmediatePropagation();
        previewSession.dispatch({ type: "activate", videoId, target });
        return;
      }
    }
    if (!session && loading) {
      if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault(); event.stopImmediatePropagation();
        // The loading shell is intentionally click-through so YouTube can wake
        // the selected thumbnail underneath it. Judge the visible preview by
        // coordinates; its DOM target is therefore not a reliable inside test.
        const { left, top, width, height } = loading.floating;
        const insideLoading = event.clientX >= left && event.clientX <= left + width &&
          event.clientY >= top && event.clientY <= top + height;
        if (!insideLoading) previewSession.dispatch({ type: "close", reason: "outside-loading" });
      }
      return;
    }
    if (session && event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        event.target instanceof Node && !session.host.contains(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation(); previewSession.dispatch({ type: "close", reason: "outside" }); return;
    }
    if (event.target instanceof Element && event.target.closest(shortsSelector)) return;
    if (!session) {
      if (!enabled || !supportedPage() || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || !(event.target instanceof Element)) return;
      const entry = resolvePreviewThumbnail(event.target, location.href);
      if (!entry) {
        const target = event.target.closest<HTMLElement>(previewThumbnailSelector);
        const collection = target ? collectionContextFor(target) : undefined;
        if (!target || !collection) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        void pageBridge.request(document, "playlist-first-video", {
          playlistId: collection.playlistId,
        }).then(result => {
          if (result.error || !result.videoId || !target.isConnected || session || loading) return;

          emitPreviewDebugLog("preview.click", {
            surface: "thumbnail",
            videoId: result.videoId,
            playlistId: result.playlistId,
          });

          previewSession.dispatch({
            type: "activate",
            videoId: result.videoId,
            target,
          });
        }, () => {});
        return;
      }
      const videoId = entry.videoId;
      event.preventDefault(); event.stopImmediatePropagation();
      emitPreviewDebugLog("preview.click", { surface: "thumbnail", videoId });
      previewSession.dispatch({ type: "activate", videoId, target: entry.target });
      return;
    }
    if (event.target instanceof Node && session.host.contains(event.target)) {
      if (event.target instanceof Element && event.target.closest("button,[role=button],input,select,[role=slider]")) return;
      // Keep the enlarged preview's click-through link from opening /watch.
      event.preventDefault();
      event.stopImmediatePropagation();
      const dismissedOverlay = overlaysOpen();
      hideOverlays();
      panel.tabIndex = -1;
      panel.focus({ preventScroll: true });
      if (!dismissedOverlay) previewSession.dispatch({ type: "control", action: "toggle-play" });
    }
  }, true);
  window.addEventListener("dblclick", event => {
    if (!supportedPage() || event.target instanceof Element && event.target.closest(shortsSelector)) return;
    if (!session || event.composedPath().includes(panel) ||
        (event.composedPath?.() ?? []).some(target => (target as HTMLElement)?.id === "skip-ads-preview-playlist") || !(event.target instanceof Element) ||
        !session.host.contains(event.target) || event.target.closest("button,[role=button],input,select,[role=slider]")) return;
    event.preventDefault(); event.stopImmediatePropagation(); previewSession.dispatch({ type: "control", action: "toggle-fullscreen" });
  }, true);
  window.addEventListener("keydown", event => {
    if (!supportedPage() || event.composedPath().some(target => target instanceof Element && target.closest(shortsSelector))) return;
    if (event.code === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && !advancedSettingsView.hidden) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) setAdvancedSettingsOpen(false, true);
      return;
    }
    if (event.code === "Escape" && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey &&
        (overlaysOpen() || session || loading)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) {
        if (overlaysOpen()) closeControlPages();
        else if (session && (document.fullscreenElement === session.host || session.fullscreenRequested))
          previewSession.dispatch({ type: "control", action: "exit-fullscreen" });
        else if (session) previewSession.dispatch({ type: "close", reason: "escape" });
        else if (loading) closePreview();
      }
      return;
    }
    const target = event.composedPath()[0];
    if (event.altKey && !event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyP") {
      if (!supportedPage() || event.repeat) return;
      event.preventDefault(); event.stopImmediatePropagation(); previewSession.dispatch({ type: "control", action: "toggle-settings" }); return;
    }
    if (session && target === element("progress") && !event.altKey && !event.ctrlKey && !event.metaKey &&
        (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
      event.preventDefault(); event.stopImmediatePropagation();
      previewSession.dispatch({ type: "control", action: "seek-by", value: event.code === "ArrowLeft" ? -5 : 5 });
      return;
    }
    const selectTrigger = target instanceof HTMLElement && target.matches(".select-trigger");
    if (!selectTrigger && target instanceof HTMLElement && target !== element("progress") && (target.isContentEditable || target.matches("input,textarea,select,[role=textbox],[role=combobox]"))) return;
    if (!session || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.shiftKey && (event.code === "KeyP" || event.code === "KeyN") && session.playlistContext) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) (event.code === "KeyP" ? playlistPreviousButton : playlistNextButton).click();
      return;
    }
    if (event.shiftKey && (event.code === "Period" || event.code === "Comma")) {
      event.preventDefault(); event.stopImmediatePropagation();
      previewSession.dispatch({ type: "control", action: "set-speed", value: session.video.playbackRate + (event.code === "Period" ? 0.25 : -0.25) }); return;
    }
    if (event.shiftKey) return;
    if (event.code === "Space" && !selectTrigger && target instanceof HTMLElement && target.matches("button,summary,a")) return;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => previewSession.dispatch({ type: "control", action: "seek-by", value: -5 }),
      ArrowRight: () => previewSession.dispatch({ type: "control", action: "seek-by", value: 5 }),
      Space: () => previewSession.dispatch({ type: "control", action: "toggle-play" }),
      KeyK: () => previewSession.dispatch({ type: "control", action: "toggle-play" }),
      KeyM: () => previewSession.dispatch({ type: "control", action: "toggle-mute" }),
      KeyC: () => previewSession.dispatch({ type: "control", action: "toggle-captions" }),
      KeyF: () => previewSession.dispatch({ type: "control", action: "toggle-fullscreen" }),
      KeyJ: () => previewSession.dispatch({ type: "control", action: "seek-by", value: -10 }),
      KeyL: () => previewSession.dispatch({ type: "control", action: "seek-by", value: 10 }),
      Home: () => previewSession.dispatch({ type: "control", action: "seek-to", value: 0 }),
      End: () => previewSession.dispatch({ type: "control", action: "seek-to", value: session!.video.duration }),
      ArrowUp: () => previewSession.dispatch({ type: "control", action: "adjust-volume", value: 0.05 }),
      ArrowDown: () => previewSession.dispatch({ type: "control", action: "adjust-volume", value: -0.05 }),
    };
    if (/^(Digit|Numpad)[0-9]$/.test(event.code) && Number.isFinite(session.video.duration)) {
      event.preventDefault(); event.stopImmediatePropagation();
      previewSession.dispatch({ type: "control", action: "seek-to", value: session.video.duration * Number(event.code.slice(-1)) / 10 }); return;
    }
    const action = actions[event.code];
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); if (!event.repeat || event.code.startsWith("Arrow")) action(); }
  }, true);
  function adjustVolume(delta: number) {
    if (!session) return;
    setVolume(session.video.volume + delta, true);
    record("Volume requested by keyboard");
  }
  function setPlaybackSpeed(rate: number) {
    const normalized = normalizePreviewPlaybackRate(rate);
    if (!session || normalized === null) return;
    session.video.playbackRate = normalized;
    if (session.qualityChange) session.qualityChange.rate = session.video.playbackRate;
    if (session.fullscreenRestore) session.fullscreenRestore.rate = session.video.playbackRate;
    if (session.startupRestore) session.startupRestore.rate = session.video.playbackRate;
    const feedback = element("speed-feedback");
    element("speed-feedback-value").textContent = `${session.video.playbackRate}×`;
    feedback.dataset.visible = "true";
    feedback.setAttribute("aria-hidden", "false");
    clearTimeout(speedFeedbackTimer);
    speedFeedbackTimer = setTimeout(() => {
      feedback.dataset.visible = "false";
      feedback.setAttribute("aria-hidden", "true");
    }, 1300);
    record("Speed requested");
  }
  function showVolumeFeedback() {
    if (!session) return;
    const feedback = element("volume-feedback");
    const percent = Math.round(session.video.volume * 100);
    feedback.dataset.muted = String(session.video.muted || percent === 0);
    element("volume-feedback-fill").style.width = `${percent}%`;
    element("volume-feedback-value").textContent = `${percent}%${session.video.muted ? ` · ${previewUiCopy(uiLanguage).mutedFeedback}` : ""}`;
    feedback.dataset.visible = "true";
    feedback.setAttribute("aria-hidden", "false");
    clearTimeout(volumeFeedbackTimer);
    volumeFeedbackTimer = setTimeout(() => {
      feedback.dataset.visible = "false";
      feedback.setAttribute("aria-hidden", "true");
    }, 1300);
  }
  document.addEventListener("yt-navigate-start", () => { pendingPin = null; release("Navigation ended the preview session."); });
  document.addEventListener("fullscreenchange", () => {
    if (!session) return;
    const fullscreen = document.fullscreenElement === session.host;
    if (!fullscreen && session.fullscreenEntered && !session.qualityChange) {
      const videoId = watchId(session.host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href);
      if (videoId) session.fullscreenRestore = { until: performance.now() + 3000, videoId,
        time: session.video.currentTime, muted: session.video.muted, volume: session.video.volume, rate: session.video.playbackRate,
        reapplyQuality: qualityChoice?.owner === session ? qualityChoice.value : undefined };
    }
    session.fullscreenEntered = fullscreen;
    if (!session.fullscreenPending || !fullscreen) session.fullscreenRequested = fullscreen;
    const keyboard = (navigator as Navigator & {
      keyboard?: { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void }
    }).keyboard;
    if (fullscreen) void keyboard?.lock?.(["Escape"]).catch(() => {});
    else keyboard?.unlock?.();
    // Native Esc is often consumed by Chrome. Retain the pinned preview and
    // return to floating mode when fullscreenchange reports the actual exit.
    if (!fullscreen) previewSession.dispatch({ type: "lifecycle", event: "arm-playback-recovery" });
    if (typeof syncPlaylistLayout === "function") {
      syncPlaylistLayout();
      requestAnimationFrame(syncPlaylistLayout);
    }
    showProgress();
    record("Fullscreen state changed");
  });
  function reconcileQualityChange() {
    const active = session;
    if (!active) return;
    const v = active.video;
    const videoId = watchId(active.host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href);
    const restoreKey = active.fullscreenRestore ? "fullscreenRestore" : "startupRestore";
    const layout = active[restoreKey];
    if (layout) {
      if (performance.now() > layout.until || videoId !== layout.videoId || !v.isConnected || !active.host.isConnected || !active.host.contains(v)) {
        active[restoreKey] = null;
      } else if (!active.qualityChange && v.currentSrc !== active.source) {
        // Native reopening and fullscreen exit can recreate MediaSource after
        // the first ready frame. Retain one bounded same-video reset.
        active.qualityChange = { ...layout, until: performance.now() + 15000 };
        active.fullscreenRestore = null; active.startupRestore = null;
        record(restoreKey === "startupRestore" ? "Retained same-video stream reset during startup" : "Retained same-video stream reset after fullscreen exit");
      }
    }
    if (!active.qualityChange && v.currentSrc !== active.source && videoId && videoId === active.videoId &&
        v.isConnected && active.host.isConnected && active.host.contains(v)) {
      // YouTube can refresh MediaSource after the short startup/fullscreen
      // windows have elapsed. The connected host's unchanged /watch identity
      // is the authority here; a different identity or detached node still
      // falls through to tick() and releases the preview.
      active.qualityChange = { until: performance.now() + 15000, videoId,
        time: v.currentTime, muted: v.muted, volume: v.volume, rate: v.playbackRate, preserveTime: false };
      record("Retained same-video native stream refresh");
    }
    const change = active.qualityChange;
    if (!change) return;
    if (!supportedPage() || !v.isConnected || !active.host.isConnected || !active.host.contains(v) || videoId !== change.videoId) return;
    if (performance.now() > change.until) {
      active.qualityChange = null;
      record("Preview quality transition timed out");
      if (change.startup) finishStartupPlayback(active);
      return;
    }
    // Accept a new stream URL only within an explicit quality request on the
    // SAME connected video, host and watch identity. Navigation still releases.
    if (v.currentSrc && v.currentSrc !== active.source) {
      active.source = v.currentSrc;
      change.changedSource = true;
      record("Retained preview during quality stream replacement");
    }
    if (v.readyState < 2) return;
    if (change.startup && (!change.quality || qualityState?.source !== v.currentSrc || qualityState.current !== change.quality)) return;
    active.qualityChange = null;
    if (change.changedSource) {
      v.volume = change.volume;
      v.playbackRate = change.rate;
      v.muted = change.muted;
      // The native player normally restores its own time; only correct a reset.
      if (change.preserveTime !== false && Math.abs(v.currentTime - change.time) > 1.5) seekTo(change.time);
      if (!change.startup) {
        if (!active.wantsPlayback && !v.paused) v.pause();
        else if (active.wantsPlayback && v.paused && !v.ended) void play();
      }
      record("Completed preview quality stream replacement");
      if (change.reapplyQuality) requestQuality(change.reapplyQuality);
    }
    if (change.startup) finishStartupPlayback(active);
  }
  function tick() {
    if (!document.documentElement) return;
    if (!style.isConnected) document.documentElement.append(style);
    panel.hidden = !supportedPage() && element("controls").hidden;
    reconcileQualityChange();
    if (session && (!supportedPage() || !session.video.isConnected || !session.host.isConnected ||
        session.video.currentSrc !== session.source && !(session.qualityChange && !session.video.currentSrc && performance.now() <= session.qualityChange.until))) {
      release("YouTube removed or replaced the preview. Click another playing preview to retry.");
    }
    if (!panel.isConnected) (session?.host ?? document.documentElement).append(panel);
    if (typeof playlistChrome !== "undefined" && !playlistChrome.isConnected) (document.fullscreenElement === session?.host ? session.host : document.documentElement).append(playlistChrome);
    if (session && typeof playlist !== "undefined" && playlist && typeof syncPlaylistLayout === "function") syncPlaylistLayout();
    if (session && session.video.readyState === 0 && !session.qualityChange && !pendingPlaylistSelection) {
      message = "YouTube stopped supplying video. Check its on-screen error; Release and hover again to retry.";
    }
    if (session?.muteRequest) {
      const request = session.muteRequest;
      if (session.video.muted !== request.value) setMuted(request.value, false);
      if (--request.ticksLeft <= 0) session.muteRequest = null;
    }
    tryPendingPin();
    render();
    applyDefaultQuality();
    reconcileStartupPlayback();
  }
  function watchId(href: string | undefined) {
    if (!href) return null;
    try { const url = new URL(href, location.href); return url.hostname === location.hostname && url.pathname === "/watch" ? url.searchParams.get("v") : null; }
    catch { return null; }
  }
  function previewWatchHref(target: Element): string | undefined {
    return target.closest<HTMLAnchorElement>("a[href]")?.href ??
      target.closest(previewSelector)?.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href;
  }
  function discardLoading() {
    stopPreviewStartupWakes();
    if (!loading) return;
    loading.host.dispatchEvent(new CustomEvent(sharedPreviewCancelEvent));
    sharedUiEvents?.abort(); sharedUiEvents = null;
    const entry = resolvePreviewThumbnail(loading.target, location.href);
    if (entry) thumbnailState(entry.target as HTMLElement, entry.videoId, "idle");
    loading.animation?.cancel();
    document.documentElement.append(panel);
    loading.host.remove(); loading = null;
    backdrop.hidden = true;
    backdrop.style.pointerEvents = "auto";
    element("preview-loading").hidden = true;
    element("top-controls").hidden = true;
  }
  function stopPreviewStartupWakes() {
    for (const timer of previewStartupWakeTimers) clearTimeout(timer);
    previewStartupWakeTimers = [];
  }
  function startPreviewRequest(videoId: string, target: Element, attempt = 1, restartNativePreview = false) {
    stopPreviewStartupWakes();
    emitPreviewDebugLog("preview.preparing", { surface: "thumbnail", videoId, attempt, restart: restartNativePreview,
      targetConnected: target.isConnected });
    activationMessage = "";
    const support = previewPlaybackSupport(target, videoId, location.pathname);
    const owned = !support.native;
    const prepared = thumbnailPreparations.get(target);
    thumbnailHover.cancel(); thumbnailIntent = null;
    thumbnailPreparations.delete(target);
    const before = owned ? undefined : findPreview(true, videoId);
    const playlistContext = typeof playlistContextFor === "function" ? playlistContextFor(target, videoId) : undefined;
    if (playlistContext) document.dispatchEvent(new CustomEvent(playlistWarmEvent, { detail: JSON.stringify({
      href: playlistContext.href, videoId, playlistId: playlistContext.playlistId, seed: playlistContext.seed,
    }) }));
    const now = performance.now();
    sharedLatency = { videoId, mechanism: owned ? "shared-preview" : "native-preview", startedAt: now };
    const reusingReleasedPreview = Boolean(before && lastReleasedPreview?.video === before && lastReleasedPreview.videoId === videoId &&
      now - lastReleasedPreview.at < 30000);
    pendingPin = { videoId, owned, until: owned ? Infinity : now + previewStartupTimeoutSeconds * 1000, notBefore: reusingReleasedPreview ? now + 1000 : now, attempt, playlistContext };
    if (!loading) {
      const host = document.createElement("div");
      host.id = "skip-ads-preview-loading-host"; host.classList.add(hostClass);
      loading = { host, floating: floatingRect(innerWidth, innerHeight), target, videoId, attempt, playlistContext };
      document.documentElement.append(backdrop, host); host.append(panel);
      backdrop.hidden = false; backdrop.style.pointerEvents = "none"; positionPlayer();
      loading.animation = animatePlayer(host, true);
    } else {
      loading.target = target; loading.videoId = videoId; loading.attempt = attempt; loading.playlistContext = playlistContext;
    }
    element("controls").hidden = true;
    element("preview-loading").hidden = false;
    element("loading-status").textContent = attempt > 1 ? previewUiCopy(uiLanguage).retryingPreview(attempt, previewStartupAttempts) : previewUiCopy(uiLanguage).startingVideo;
    element("loading-pulse").hidden = false;
    element("loading-retry").hidden = true;
    render();
    loading.owned = owned;
    if (owned) {
      const host = loading.host;
      host.dataset.skipPreviewOwned = videoId;
      delete host.dataset.skipPreviewOwnedReady;
      let anchor = host.querySelector<HTMLAnchorElement>("a[data-shared-preview-link]");
      if (!anchor) { anchor = document.createElement("a"); anchor.dataset.sharedPreviewLink = ""; anchor.hidden = true; host.append(anchor); }
      anchor.href = `${location.origin}/watch?v=${encodeURIComponent(videoId)}`;
      const requestId = `shared-${Date.now()}-${++thumbnailSequence}`;
      sharedUiEvents?.abort(); sharedUiEvents = new AbortController();
      host.addEventListener(sharedPreviewResultEvent, event => {
        let result: SharedPreviewResult;
        try { result = JSON.parse((event as CustomEvent).detail); } catch { return; }
        if (loading?.host !== host || result.requestId !== requestId || loading.closing || pendingPin?.videoId !== videoId) return;
        if (result.phase === "ready") { if (sharedLatency?.videoId === videoId) sharedLatency.firstFrameMs = Math.round(performance.now() - sharedLatency.startedAt); thumbnailState(target as HTMLElement, videoId, "playing"); tryPendingPin(); return; }
        pendingPin = null;
        thumbnailState(target as HTMLElement, videoId, "error");
        activationMessage = previewUiCopy(uiLanguage).previewError(result.error);
        element("loading-status").textContent = activationMessage;
        element("loading-pulse").hidden = true; element("loading-retry").hidden = false;
        record(result.error);
      }, { signal: sharedUiEvents.signal });
      thumbnailState(target as HTMLElement, videoId, "preparing");
      const rect = target.getBoundingClientRect();
      host.dispatchEvent(new CustomEvent(sharedPreviewStartEvent, { detail: JSON.stringify({
        videoId, requestId, actionId: prepared?.requestId ?? requestId,
        retentionCapacity: playlistPreviewRetentionCapacity, retryLimit: playlistStageRetryLimit,
        timeoutMultipliers: playlistBrokerTimeoutMultipliers,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      }) }));
      return;
    }
    // Wake the selected thumbnail through native DOM hover handlers. This is
    // only a bounded response to an explicit preview request, never a new player.
    const originalThumbnail = target.closest("ytd-thumbnail, yt-thumbnail-view-model") ?? target;
    const currentThumbnail = (refresh = false) => resolvePreviewStartupWakeTarget(originalThumbnail, videoId,
      document.querySelectorAll<Element>("ytd-thumbnail, yt-thumbnail-view-model"),
      candidate => watchId(previewWatchHref(candidate)), refresh);
    const hoverLineage = (thumbnail: Element) => {
      const card = thumbnail.closest(sourceCardSelector) ?? thumbnail;
      const lineage: Element[] = [];
      for (let item: Element | null = thumbnail; item; item = item.parentElement) {
        lineage.push(item); if (item === card) break;
      }
      return lineage;
    };
    const hoverInit = (thumbnail: Element) => {
      const rect = thumbnail.getBoundingClientRect();
      return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, view: window };
    };
    const leave = (thumbnail: Element) => {
      const init = hoverInit(thumbnail);
      nativeAction = true;
      try {
        for (const item of hoverLineage(thumbnail)) {
          item.dispatchEvent(new PointerEvent("pointerleave", { ...init, pointerType: "mouse" }));
          item.dispatchEvent(new MouseEvent("mouseleave", init));
        }
        thumbnail.dispatchEvent(new MouseEvent("mouseout", { ...init, bubbles: true }));
      } finally { nativeAction = false; }
    };
    const enter = (thumbnail: Element) => {
      const init = hoverInit(thumbnail);
      nativeAction = true;
      try {
        // Native listeners live on #dismissible in search and on the
        // corresponding inner lockup in Home. Mouseenter does not bubble, so
        // visit the ancestry. Repeat a bounded wake sequence because YouTube
        // may replace the renderer or finish installing handlers after click.
        for (const item of hoverLineage(thumbnail).reverse()) {
          item.dispatchEvent(new PointerEvent("pointerenter", { ...init, pointerType: "mouse" }));
          item.dispatchEvent(new MouseEvent("mouseenter", init));
        }
        thumbnail.dispatchEvent(new MouseEvent("mouseover", { ...init, bubbles: true }));
        thumbnail.dispatchEvent(new MouseEvent("mousemove", { ...init, bubbles: true }));
      } finally { nativeAction = false; }
    };
    const firstTarget = currentThumbnail(restartNativePreview);
    if (firstTarget) {
      firstTarget.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      if (loading) loading.target = firstTarget;
      if (restartNativePreview) leave(firstTarget);
    }
    previewStartupWakeTimers = previewStartupWakeDelaysMs.map(delay => setTimeout(() => {
      if (!pendingPin || pendingPin.videoId !== videoId || pendingPin.attempt !== attempt || session) return;
      const thumbnail = currentThumbnail(restartNativePreview || delay > 0);
      if (!thumbnail) return;
      if (loading) loading.target = thumbnail;
      enter(thumbnail);
    }, delay));
  }
  element("loading-retry").onclick = () => {
    if (typeof playlistSelectionRetry !== "undefined" && playlistSelectionRetry && session) {
      const videoId = playlistSelectionRetry;
      playlistSelectionRetry = null;
      const row = playlistList.querySelector<HTMLElement>(`.playlist-item[data-video-id="${CSS.escape(videoId)}"]`);
      const rect = row?.getBoundingClientRect() ?? session.host.getBoundingClientRect();
      const bounds = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      const actionId = primePlaylistItem(videoId, bounds, "click");
      queueMicrotask(() => previewSession.dispatch({ type: "playlist", action: "select", videoId,
        actionId: actionId ?? undefined, rect: bounds }));
      return;
    }
    if (loading && !loading.closing) { startPreviewRequest(loading.videoId, loading.target, 1, true); tryPendingPin(); }
  };
  // Pin as soon as the first decoded frame exists, without waiting for the poll.
  for (const name of ["loadeddata", "canplay", "playing"]) document.addEventListener(name, () => { if (pendingPin) tryPendingPin(); }, true);
  function tryPendingPin() {
    if (!pendingPin || !enabled || session) return;
    if (performance.now() < pendingPin.notBefore) return;
    // A click expresses playback intent even if native hover playback has paused.
    // Match identity before pinning so another thumbnail cannot win discovery.
    const video = findPreview(true, pendingPin.videoId);
    if (pendingPin.owned && (!loading?.host.dataset.skipPreviewOwnedReady || !video || resolvePreviewHost(video) !== loading.host)) return;
    const host = video ? resolvePreviewHost(video) : null;
    const href = host?.querySelector<HTMLAnchorElement>("a[href*='/watch?']")?.href;
    if (video && watchId(href) === pendingPin.videoId) {
      const request = pendingPin;
      pendingPin = null;
      stopPreviewStartupWakes();
      emitPreviewDebugLog("preview.ready", { surface: "thumbnail", videoId: request.videoId, attempt: request.attempt,
        readyState: video.readyState, mechanism: request.owned ? "shared-preview" : "native-preview" });
      if (!request.owned && sharedLatency?.videoId === request.videoId)
        sharedLatency.firstFrameMs = Math.round(performance.now() - sharedLatency.startedAt);
      pin(video, request.playlistContext ?? loading?.playlistContext);
    } else if (performance.now() >= pendingPin.until) {
      const request = pendingPin;
      pendingPin = null;
      if (request.attempt < previewStartupAttempts && loading && !loading.closing) {
        startPreviewRequest(request.videoId, loading.target, request.attempt + 1, true);
        record(`Retrying preview startup (${request.attempt + 1} / ${previewStartupAttempts})`);
        return;
      }
      activationMessage = previewUiCopy(uiLanguage).previewUnavailableNoVideo;
      stopPreviewStartupWakes();
      element("loading-status").textContent = activationMessage;
      element("loading-pulse").hidden = true;
      element("loading-retry").hidden = false;
      record("Clicked thumbnail did not supply a playable preview");
    }
  }
  const timer = setInterval(tick, 500);
  window.addEventListener("pagehide", () => {
    chrome.storage.onChanged.removeListener(onSearchStorageChange);
    playlistHoverIntent.cancel();
    previewSession.dispose();
    clearInterval(timer);
    scrollDiagnostics.flush(playlistScrollSnapshot());
    flushDebugInteractionSummary();
    diagnosticSession.flush();
  }, { once: true });
  tick();
})();
