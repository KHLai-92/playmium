import { playlistBrokerTimeoutSecondsRanges, playlistBrokerTimeoutSecondsStep,
  type PlaylistBrokerStage } from "./preview-playlist";
import { previewStartupTimeoutSecondsRange } from "./preview-startup";
import type { PreviewUiCopy, PreviewUiLanguage } from "./preview-ui-language";

const playlistStages = ["starting", "ready", "request"] as const;

export type AdvancedSettingsModel = Readonly<{
  language: PreviewUiLanguage;
  copy: PreviewUiCopy;
  urlSearchEnabled: boolean;
  previewStartupAttempts: number;
  previewStartupTimeoutSeconds: number;
  playlistStageAttempts: number;
  playlistTimeoutSeconds: Readonly<Record<PlaylistBrokerStage, number>>;
  restoreBusy: boolean;
}>;

export type AdvancedSettingsAction =
  | Readonly<{ type: "search-mode"; useFullUrl: boolean }>
  | Readonly<{ type: "startup-attempts"; attempts: number }>
  | Readonly<{ type: "startup-timeout"; seconds: number; persist: boolean }>
  | Readonly<{ type: "playlist-stage-attempts"; attempts: number }>
  | Readonly<{ type: "playlist-timeout"; stage: PlaylistBrokerStage; seconds: number; persist: boolean }>
  | Readonly<{ type: "restore-defaults" }>;

export type AdvancedSettingsController = Readonly<{
  render(model: AdvancedSettingsModel): void;
  open(focus?: boolean): void;
  close(focus?: boolean): void;
  isOpen(): boolean;
  contains(path: readonly EventTarget[]): boolean;
}>;

type AdvancedSettingsOptions = Readonly<{
  document: Document;
  surface: ShadowRoot;
  actionHost: HTMLElement;
  owner: HTMLElement;
  initialModel: AdvancedSettingsModel;
  closeTransientControls(): void;
  onAction(action: AdvancedSettingsAction): void;
}>;

const advancedSettingsCss = `
  #advanced-settings{z-index:7;right:12px;width:min(560px,calc(100% - 24px));max-width:none;min-width:0;padding:0 18px 16px;overflow-x:hidden}
  #advanced-settings-header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:64px;border-bottom:1px solid #ffffff1c}
  #advanced-settings-header strong{font-size:16px}
  #advanced-settings-title-group{display:flex;align-items:center;gap:9px}
  #advanced-settings-close{display:grid;place-items:center;width:34px;height:34px;padding:0;background:transparent;border:0;color:#aeb9c7;font-size:18px}
  #advanced-settings-close:hover,#advanced-settings-close:focus-visible{background:transparent;border:0;color:#fff;outline:0}
  #advanced-settings>.settings-group{border-top:1px solid #ffffff1c;margin-top:14px;padding-top:14px}
  #advanced-settings>.settings-group-first{border-top:0;margin-top:12px;padding-top:0}
  #advanced-settings .settings-group h3{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0;color:#73aeb0;font-size:13px;font-weight:650}
  #advanced-settings .settings-group>.row{margin-top:11px}
  #advanced-settings .settings-group>.row>label{display:grid;grid-template-columns:minmax(220px,1fr) 190px 56px;align-items:center;gap:12px;width:100%;white-space:nowrap}
  #advanced-settings .setting-label{min-width:0}
  #advanced-settings .search-mode-card{display:grid;grid-template-columns:minmax(220px,1fr) 190px 56px;align-items:center;gap:12px;min-height:39px;margin:7px 0 0;padding:0;background:transparent;border:0;border-radius:0}
  #advanced-settings .search-mode-buttons{grid-column:2;width:calc(100% - 3px);margin-left:3px}
  #advanced-settings .search-mode-buttons,#advanced-settings .settings-choice{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;padding:2px;border:1px solid #414e5d;border-radius:8px;background:#10161d}
  #advanced-settings .search-mode-buttons button,#advanced-settings .settings-choice button{min-width:0;min-height:28px;padding:3px 8px;border:0;border-radius:5px;background:transparent;color:#aeb9c7;font-size:12.5px;white-space:nowrap}
  #advanced-settings .search-mode-buttons button[aria-pressed=true],#advanced-settings .settings-choice button[aria-pressed=true]{background:#385262;color:#f4fbff;box-shadow:0 0 0 1px #75b9ca inset}
  #advanced-settings .settings-choice{grid-column:2;width:calc(100% - 3px);margin-left:3px}
  #advanced-settings .settings-value-spacer{grid-column:3}
  #advanced-settings .settings-group input[type=range]{width:100%;min-width:0}
  #advanced-settings .settings-group output{text-align:right;color:#dbe5ef;font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
  #advanced-settings .restore-row{display:flex;justify-content:flex-end;border-top:1px solid #ffffff1c;margin-top:13px;padding-top:12px}
  #restore-defaults{background:transparent;border-color:#ffffff2e;color:#d6dee8}
  #restore-defaults:hover,#restore-defaults:focus-visible{background:#ffffff10;border-color:#ffffff52}
  .settings-help{position:relative;z-index:2;display:inline-grid;place-items:center;flex:0 0 19px;width:19px;height:19px;border:1px solid #53718e;border-radius:50%;background:#1b2b3b;color:#9fd4ff;font:700 11px/1 system-ui;cursor:help}
  .settings-help:hover,.settings-help:focus-visible,.settings-help[aria-expanded=true]{border-color:#75d9ff;color:#dff4ff;outline:0;box-shadow:0 0 0 2px #63d5ff2b}
  .settings-text-help{width:max-content;max-width:100%;border-radius:4px;cursor:help;text-decoration:underline dotted transparent;text-underline-offset:4px;transition:color .12s,text-decoration-color .12s,background .12s}
  .settings-text-help:hover,.settings-text-help:focus-visible,.settings-text-help[aria-expanded=true]{color:#eafffb;text-decoration-color:#65d7c8;outline:0;background:#5eead40b}
  #settings-tooltip{position:absolute;z-index:20;width:200px;max-width:calc(100% - 32px);padding:9px 11px;border:1px solid #52677b;border-radius:9px;background:#222c38;color:#eef4fa;box-shadow:0 14px 36px #000b;font:400 12px/1.42 system-ui;white-space:normal;overflow-wrap:break-word;pointer-events:none}
  #settings-tooltip::before{content:"";position:absolute;width:9px;height:9px;transform:rotate(45deg);background:#222c38}
  #settings-tooltip[data-side=right]::before{left:-5px;top:var(--arrow-top,18px);border-left:1px solid #52677b;border-bottom:1px solid #52677b}
  #settings-tooltip[data-side=left]::before{right:-5px;top:var(--arrow-top,18px);border-right:1px solid #52677b;border-top:1px solid #52677b}
  #settings-tooltip[data-side=below]::before{top:-5px;left:var(--arrow-left,22px);border-left:1px solid #52677b;border-top:1px solid #52677b}
  #settings-tooltip[data-side=above]::before{bottom:-5px;left:var(--arrow-left,22px);border-right:1px solid #52677b;border-bottom:1px solid #52677b}
  @container(min-width:1040px){#advanced-settings{right:468px}}
  @container(max-width:620px){#advanced-settings .settings-group>.row>label{grid-template-columns:minmax(0,1fr) 56px;row-gap:6px;white-space:normal}#advanced-settings .setting-label{grid-column:1/-1}#advanced-settings .settings-group input[type=range],#advanced-settings .settings-choice{grid-column:1;width:calc(100% - 3px);margin-left:3px}#advanced-settings .settings-group output{grid-column:2}#advanced-settings .settings-value-spacer{grid-column:2}#advanced-settings .search-mode-card{grid-template-columns:minmax(0,1fr) 56px;row-gap:6px}#advanced-settings .search-mode-card strong{grid-column:1/-1}#advanced-settings .search-mode-buttons{grid-column:1;width:calc(100% - 3px);margin-left:3px}}
`;

const tooltipWidths: Readonly<Record<PreviewUiLanguage, Readonly<Record<string, number>>>> = {
  en: {
    "advanced-settings-help": 168,
    "url-search-label": 300,
    "preview-startup-attempts-label": 220,
    "preview-startup-timeout-label": 146,
    "playlist-retries-label": 136,
    "playlist-starting-timeout-label": 170,
    "playlist-ready-timeout-label": 130,
    "playlist-request-timeout-label": 138,
  },
  "zh-TW": {
    "advanced-settings-help": 146,
    "url-search-label": 200,
    "preview-startup-attempts-label": 133,
    "preview-startup-timeout-label": 160,
    "playlist-retries-label": 110,
    "playlist-starting-timeout-label": 130,
    "playlist-ready-timeout-label": 142,
    "playlist-request-timeout-label": 150,
  },
};

export function createAdvancedSettings(options: AdvancedSettingsOptions): AdvancedSettingsController {
  const node = <K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Record<string, string>,
    ...children: (Node | string)[]) => {
    const result = options.document.createElement(tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    result.append(...children);
    return result;
  };
  const row = (...children: Node[]) => node("div", { class: "row" }, ...children);
  const helpIcon = node("span", {
    id: "advanced-settings-help", class: "settings-help", role: "note", tabindex: "0",
    "aria-expanded": "false",
  }, "i");
  const textHelp = (id: string, text: string) => node("span", {
    id, class: "setting-label settings-text-help", tabindex: "0", "aria-expanded": "false",
  }, text);
  const choice = (id: string, label: string) => node("div", {
    id, class: "settings-choice", role: "group", "aria-label": label,
  }, ...[1, 2, 3].map(value => node("button", {
    type: "button", "data-value": String(value), "aria-pressed": "false",
  }, String(value))));
  const setChoice = (control: HTMLElement, value: number) => {
    for (const button of control.querySelectorAll<HTMLButtonElement>("button[data-value]")) {
      button.setAttribute("aria-pressed", String(Number(button.dataset.value) === value));
    }
  };
  const settingRow = (labelId: string, label: string, control: HTMLElement, output: HTMLElement) =>
    row(node("label", {}, textHelp(labelId, label), control, output));

  const openButton = node("button", {
    id: "advanced-settings-open", type: "button", class: "panel-nav-button",
    "aria-expanded": "false", "aria-controls": "advanced-settings",
  }, node("span", { id: "advanced-settings-label" }, "Advanced settings"));
  const closeButton = node("button", {
    id: "advanced-settings-close", type: "button", "aria-label": "Close advanced settings",
  }, String.fromCodePoint(0x00D7));
  const view = node("section", {
    id: "advanced-settings", role: "dialog", "aria-labelledby": "advanced-settings-title", hidden: "",
  });
  const tooltip = node("div", { id: "settings-tooltip", role: "tooltip", hidden: "" });
  const header = node("div", { id: "advanced-settings-header" },
    node("div", { id: "advanced-settings-title-group" },
      node("strong", { id: "advanced-settings-title" }, "Advanced settings"), helpIcon),
    closeButton);

  const startupAttempts = choice("preview-startup-attempts", "Max attempts");
  const startupTimeout = node("input", {
    id: "preview-startup-timeout", type: "range",
    min: String(previewStartupTimeoutSecondsRange.min), max: String(previewStartupTimeoutSecondsRange.max),
    step: String(previewStartupTimeoutSecondsRange.step), value: String(options.initialModel.previewStartupTimeoutSeconds),
  });
  const startupTimeoutOutput = node("output", {
    id: "preview-startup-timeout-value", for: "preview-startup-timeout",
  });
  const nativeGroup = node("div", { class: "settings-group settings-group-first" },
    node("h3", { id: "youtube-native-previews-heading" }, "YouTube native previews"),
    settingRow("preview-startup-attempts-label", "Max attempts", startupAttempts,
      node("span", { class: "settings-value-spacer", "aria-hidden": "true" })),
    settingRow("preview-startup-timeout-label", "Attempt timeout", startupTimeout, startupTimeoutOutput));

  const videoIdSearch = node("button", { id: "video-id-search", type: "button", "aria-pressed": "false" }, "Video ID");
  const urlSearch = node("button", { id: "url-search", type: "button", "aria-pressed": "false" }, "Full URL");
  const searchButtons = node("div", { class: "search-mode-buttons", role: "group", "aria-labelledby": "url-search-label" },
    videoIdSearch, urlSearch);
  const playlistAttempts = choice("playlist-stage-retry-limit", "Max attempts/step");
  const timeoutInputs = {} as Record<PlaylistBrokerStage, HTMLInputElement>;
  const timeoutOutputs = {} as Record<PlaylistBrokerStage, HTMLOutputElement>;
  const timeoutRows = playlistStages.map(stage => {
    const id = `playlist-${stage}-timeout-seconds`;
    const range = playlistBrokerTimeoutSecondsRanges[stage];
    const input = node("input", {
      id, type: "range", min: String(range.min), max: String(range.max),
      step: String(playlistBrokerTimeoutSecondsStep), value: String(options.initialModel.playlistTimeoutSeconds[stage]),
    });
    const output = node("output", { id: `${id}-value`, for: id, class: "playlist-timeout-output" });
    timeoutInputs[stage] = input;
    timeoutOutputs[stage] = output;
    return settingRow(`playlist-${stage}-timeout-label`, stage, input, output);
  });
  const addedGroup = node("div", { class: "settings-group" },
    node("h3", { id: "playmium-added-previews-heading" }, "Playmium-added previews"),
    node("div", { class: "preview-mode-card search-mode-card" },
      textHelp("url-search-label", "Search method"), searchButtons),
    settingRow("playlist-retries-label", "Max attempts/step", playlistAttempts,
      node("span", { class: "settings-value-spacer", "aria-hidden": "true" })),
    ...timeoutRows);
  const restoreButton = node("button", { id: "restore-defaults", type: "button" }, "Reset all settings");
  const restoreRow = node("div", { class: "restore-row" }, restoreButton);
  view.append(header, nativeGroup, addedGroup, restoreRow, tooltip);

  const style = options.document.createElement("style");
  style.textContent = advancedSettingsCss;
  options.actionHost.append(openButton);
  options.surface.append(style, view);

  const tooltipTargets = [
    helpIcon,
    view.querySelector<HTMLElement>("#url-search-label")!,
    view.querySelector<HTMLElement>("#preview-startup-attempts-label")!,
    view.querySelector<HTMLElement>("#preview-startup-timeout-label")!,
    view.querySelector<HTMLElement>("#playlist-retries-label")!,
    view.querySelector<HTMLElement>("#playlist-starting-timeout-label")!,
    view.querySelector<HTMLElement>("#playlist-ready-timeout-label")!,
    view.querySelector<HTMLElement>("#playlist-request-timeout-label")!,
  ];
  let model = options.initialModel;
  let activeTooltipTarget: HTMLElement | null = null;

  function hideTooltip() {
    tooltip.hidden = true;
    if (activeTooltipTarget) activeTooltipTarget.setAttribute("aria-expanded", "false");
    activeTooltipTarget = null;
  }

  function showTooltip(target: HTMLElement) {
    const text = target.dataset.tooltip;
    if (!text) return hideTooltip();
    if (activeTooltipTarget && activeTooltipTarget !== target) {
      activeTooltipTarget.setAttribute("aria-expanded", "false");
    }
    activeTooltipTarget = target;
    target.setAttribute("aria-expanded", "true");
    tooltip.textContent = text;
    tooltip.style.width = `${tooltipWidths[model.language][target.id] ?? 200}px`;
    tooltip.hidden = false;
    tooltip.style.left = "0px";
    tooltip.style.top = "0px";
    const panelRect = view.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const margin = 16;
    const gap = 10;
    const scrollLeft = view.scrollLeft;
    const scrollTop = view.scrollTop;
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
      side = below + tooltipRect.height <= scrollTop + view.clientHeight - margin ? "below" : "above";
      left = centerX - tooltipRect.width / 2;
      top = side === "below" ? below : above;
    }
    left = Math.max(scrollLeft + margin, Math.min(left,
      scrollLeft + view.clientWidth - tooltipRect.width - margin));
    top = Math.max(scrollTop + margin, Math.min(top,
      scrollTop + view.clientHeight - tooltipRect.height - margin));
    tooltip.dataset.side = side;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.setProperty("--arrow-left", `${Math.max(12, Math.min(centerX - left - 4, tooltipRect.width - 22))}px`);
    tooltip.style.setProperty("--arrow-top", `${Math.max(10, Math.min(centerY - top - 4, tooltipRect.height - 20))}px`);
  }

  for (const target of tooltipTargets) {
    target.addEventListener("mouseenter", () => showTooltip(target));
    target.addEventListener("mouseleave", () => { if (options.surface.activeElement !== target) hideTooltip(); });
    target.addEventListener("focus", () => showTooltip(target));
    target.addEventListener("blur", hideTooltip);
  }
  view.addEventListener("scroll", hideTooltip, { passive: true });

  function setOpen(open: boolean, focus = true) {
    hideTooltip();
    view.hidden = !open;
    openButton.setAttribute("aria-expanded", String(open));
    options.closeTransientControls();
    if (focus) (open ? closeButton : openButton).focus({ preventScroll: true });
  }
  openButton.onclick = () => setOpen(true);
  closeButton.onclick = () => setOpen(false);
  new MutationObserver(() => {
    if (options.owner.hidden) setOpen(false, false);
  }).observe(options.owner, { attributes: true, attributeFilter: ["hidden"] });

  videoIdSearch.onclick = () => options.onAction({ type: "search-mode", useFullUrl: false });
  urlSearch.onclick = () => options.onAction({ type: "search-mode", useFullUrl: true });
  startupAttempts.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-value]") : null;
    if (button && startupAttempts.contains(button)) {
      options.onAction({ type: "startup-attempts", attempts: Number(button.dataset.value) });
    }
  });
  startupTimeout.oninput = () => options.onAction({
    type: "startup-timeout", seconds: Number(startupTimeout.value), persist: false,
  });
  startupTimeout.onchange = () => options.onAction({
    type: "startup-timeout", seconds: Number(startupTimeout.value), persist: true,
  });
  playlistAttempts.addEventListener("click", event => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-value]") : null;
    if (button && playlistAttempts.contains(button)) {
      options.onAction({ type: "playlist-stage-attempts", attempts: Number(button.dataset.value) });
    }
  });
  for (const stage of playlistStages) {
    timeoutInputs[stage].oninput = () => options.onAction({
      type: "playlist-timeout", stage, seconds: Number(timeoutInputs[stage].value), persist: false,
    });
    timeoutInputs[stage].onchange = () => options.onAction({
      type: "playlist-timeout", stage, seconds: Number(timeoutInputs[stage].value), persist: true,
    });
  }
  restoreButton.onclick = () => options.onAction({ type: "restore-defaults" });

  const applyTooltip = (target: HTMLElement, text: string, useAriaLabel = false) => {
    target.dataset.tooltip = text;
    target.setAttribute(useAriaLabel ? "aria-label" : "aria-description", text);
  };
  function render(next: AdvancedSettingsModel) {
    model = next;
    const copy = model.copy;
    openButton.querySelector<HTMLElement>("#advanced-settings-label")!.textContent = copy.advancedSettings;
    view.querySelector<HTMLElement>("#advanced-settings-title")!.textContent = copy.advancedSettings;
    applyTooltip(helpIcon, copy.advancedSettingsIntro, true);
    closeButton.setAttribute("aria-label", copy.closeAdvancedSettings);
    view.querySelector<HTMLElement>("#youtube-native-previews-heading")!.textContent = copy.youtubeNativePreviews;
    view.querySelector<HTMLElement>("#playmium-added-previews-heading")!.textContent = copy.playmiumAddedPreviews;

    const searchLabel = view.querySelector<HTMLElement>("#url-search-label")!;
    searchLabel.textContent = copy.urlSearchMethod;
    applyTooltip(searchLabel, copy.urlSearchHelp);
    videoIdSearch.textContent = copy.urlSearchVideoId;
    urlSearch.textContent = copy.urlSearchFullUrl;
    videoIdSearch.setAttribute("aria-pressed", String(!model.urlSearchEnabled));
    urlSearch.setAttribute("aria-pressed", String(model.urlSearchEnabled));

    const startupAttemptsLabel = view.querySelector<HTMLElement>("#preview-startup-attempts-label")!;
    startupAttemptsLabel.textContent = copy.previewStartupAttempts;
    applyTooltip(startupAttemptsLabel, copy.previewStartupAttemptsHelp);
    startupAttempts.setAttribute("aria-label", copy.previewStartupAttempts);
    setChoice(startupAttempts, model.previewStartupAttempts);
    const startupTimeoutLabel = view.querySelector<HTMLElement>("#preview-startup-timeout-label")!;
    startupTimeoutLabel.textContent = copy.previewStartupTimeout;
    applyTooltip(startupTimeoutLabel, copy.previewStartupTimeoutHelp);
    startupTimeout.setAttribute("aria-label", copy.previewStartupTimeout);
    startupTimeout.value = String(model.previewStartupTimeoutSeconds);
    startupTimeout.setAttribute("aria-valuetext", copy.seconds(model.previewStartupTimeoutSeconds));
    startupTimeoutOutput.value = copy.seconds(model.previewStartupTimeoutSeconds);

    const attemptsLabel = view.querySelector<HTMLElement>("#playlist-retries-label")!;
    attemptsLabel.textContent = copy.retriesPerLoadingStep;
    applyTooltip(attemptsLabel, copy.retriesPerLoadingStepHelp);
    playlistAttempts.setAttribute("aria-label", copy.retriesPerLoadingStep);
    setChoice(playlistAttempts, model.playlistStageAttempts);
    for (const [stage, label, help] of [
      ["starting", copy.preparePreviewTimeout, copy.preparePreviewTimeoutHelp],
      ["ready", copy.startPlayerTimeout, copy.startPlayerTimeoutHelp],
      ["request", copy.loadVideoTimeout, copy.loadVideoTimeoutHelp],
    ] as const) {
      const labelElement = view.querySelector<HTMLElement>(`#playlist-${stage}-timeout-label`)!;
      labelElement.textContent = label;
      applyTooltip(labelElement, help);
      timeoutInputs[stage].setAttribute("aria-label", label);
      timeoutInputs[stage].setAttribute("aria-description", help);
      timeoutInputs[stage].value = String(model.playlistTimeoutSeconds[stage]);
      timeoutInputs[stage].setAttribute("aria-valuetext", copy.seconds(model.playlistTimeoutSeconds[stage]));
      timeoutOutputs[stage].value = copy.seconds(model.playlistTimeoutSeconds[stage]);
    }
    restoreButton.textContent = copy.restoreAllDefaults;
    restoreButton.disabled = model.restoreBusy;
    if (activeTooltipTarget) showTooltip(activeTooltipTarget);
  }

  render(model);
  return {
    render,
    open: (focus = true) => setOpen(true, focus),
    close: (focus = true) => setOpen(false, focus),
    isOpen: () => !view.hidden,
    contains: path => path.includes(view),
  };
}
