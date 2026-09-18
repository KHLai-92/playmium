export type PreviewControlAction =
  | "toggle-play" | "play" | "pause"
  | "toggle-mute" | "set-muted" | "set-volume" | "adjust-volume"
  | "set-speed" | "seek-by" | "seek-to"
  | "toggle-fullscreen" | "exit-fullscreen"
  | "toggle-captions" | "select-caption-language" | "select-caption-translation"
  | "select-quality"
  | "toggle-settings" | "toggle-chapters" | "toggle-info" | "toggle-playlist" | "toggle-playlist-autoplay";

export type PreviewIntent =
  | { type: "activate"; videoId: string; target: unknown; playlist?: unknown }
  | { type: "control"; action: PreviewControlAction; value?: unknown }
  | { type: "playlist"; action: "select" | "retry"; videoId?: string; actionId?: string;
      rect?: { left: number; top: number; width: number; height: number } }
  | { type: "lifecycle"; event: "startup-ready" | "arm-playback-recovery" }
  | { type: "lifecycle"; event: "media-pause"; playable: boolean }
  | { type: "close"; reason: string };

export type PreviewSessionView = Readonly<{
  phase: "idle" | "loading" | "active" | "closing" | "disposed" | "error";
  videoId: string;
  wantsPlayback: boolean;
  message: string;
}>;

export type PreviewDispatchResult = Readonly<{ handled: boolean; view: PreviewSessionView }>;
type Completion = void | Partial<PreviewSessionView>;
export type PreviewBrowser = Readonly<{
  activate?(intent: Extract<PreviewIntent, { type: "activate" }>, context: { signal: AbortSignal }): Completion | Promise<Completion>;
  control?(intent: Extract<PreviewIntent, { type: "control" }>, context: { signal: AbortSignal }): Completion | Promise<Completion>;
  playlist?(intent: Extract<PreviewIntent, { type: "playlist" }>, context: { signal: AbortSignal }): Completion | Promise<Completion>;
  playbackPaused?(): boolean;
  close?(intent: Extract<PreviewIntent, { type: "close" }>): void;
  dispose?(): void;
}>;

export function createPreviewSession(dependencies: { browser: PreviewBrowser; present(view: PreviewSessionView): void; now?: () => number }) {
  let generation = 0;
  let controlGeneration = 0;
  let lifetime = new AbortController();
  let controlLifetime = new AbortController();
  let disposed = false;
  let playbackRecoveryUntil = 0;
  const now = dependencies.now ?? (() => performance.now());
  let view: PreviewSessionView = { phase: "idle", videoId: "", wantsPlayback: true, message: "" };
  const publish = (patch: Partial<PreviewSessionView>) => {
    view = { ...view, ...patch };
    dependencies.present(view);
  };
  const publishBrowserCompletion = (patch: Completion) => {
    if (!patch) return;
    const { wantsPlayback: _browserPlaybackIntent, ...browserFacts } = patch;
    publish(browserFacts);
  };
  const begin = (intent: PreviewIntent, operation: ((intent: any, context: { signal: AbortSignal }) => Completion | Promise<Completion>) | undefined) => {
    if (!operation) return false;
    controlLifetime.abort();
    controlGeneration++;
    lifetime.abort();
    lifetime = new AbortController();
    const signal = lifetime.signal;
    const expected = ++generation;
    if (intent.type === "activate") publish({ phase: "loading", videoId: intent.videoId, message: "" });
    let completion: Completion | Promise<Completion>;
    try { completion = operation(intent, { signal }); }
    catch (error) { publish({ phase: "error", message: error instanceof Error ? error.message : "Preview operation failed." }); return true; }
    void Promise.resolve(completion).then(patch => {
      if (disposed || signal.aborted || generation !== expected || !patch) return;
      publishBrowserCompletion(patch);
    }, error => {
      if (disposed || signal.aborted || generation !== expected) return;
      publish({ phase: "error", message: error instanceof Error ? error.message : "Preview operation failed." });
    });
    return true;
  };
  const dispatch = (intent: PreviewIntent): PreviewDispatchResult => {
      if (disposed) return { handled: false, view };
      let handled = false;
      if (intent.type === "activate") handled = begin(intent, dependencies.browser.activate);
      else if (intent.type === "control") {
        let browserIntent = intent;
        if (intent.action === "toggle-play") {
          const paused = view.phase === "loading" ? !view.wantsPlayback : dependencies.browser.playbackPaused?.() ?? !view.wantsPlayback;
          browserIntent = { ...intent, action: paused ? "play" : "pause" };
        }
        if (browserIntent.action === "play") { playbackRecoveryUntil = 0; publish({ wantsPlayback: true }); }
        if (browserIntent.action === "pause") { playbackRecoveryUntil = 0; publish({ wantsPlayback: false }); }
        const operation = dependencies.browser.control;
        if (operation) {
          controlLifetime.abort();
          controlLifetime = new AbortController();
          const signal = controlLifetime.signal;
          const expectedControl = ++controlGeneration;
          try {
            void Promise.resolve(operation(browserIntent, { signal })).then(patch => {
              if (!disposed && !signal.aborted && controlGeneration === expectedControl) publishBrowserCompletion(patch);
            }, error => {
              if (!disposed && !signal.aborted && controlGeneration === expectedControl) publish({ phase: "error", message: error instanceof Error ? error.message : "Preview control failed." });
            });
          } catch (error) {
            publish({ phase: "error", message: error instanceof Error ? error.message : "Preview control failed." });
          }
          handled = true;
        }
      } else if (intent.type === "playlist") handled = begin(intent, dependencies.browser.playlist);
      else if (intent.type === "lifecycle") {
        handled = true;
        if (intent.event === "startup-ready") publish({ phase: "active", message: "" });
        if (intent.event === "startup-ready" || intent.event === "arm-playback-recovery") {
          if (view.wantsPlayback) {
            if (dependencies.browser.playbackPaused?.() ?? true) dispatch({ type: "control", action: "play" });
            playbackRecoveryUntil = now() + 1500;
          }
        } else if (intent.event === "media-pause" && intent.playable && view.wantsPlayback && now() <= playbackRecoveryUntil) {
          playbackRecoveryUntil = 0;
          dispatch({ type: "control", action: "play" });
        }
      }
      else {
        if (view.phase === "closing") return { handled: true, view };
        lifetime.abort(); controlLifetime.abort(); generation++; controlGeneration++; playbackRecoveryUntil = 0;
        dependencies.browser.close?.(intent);
        publish({ phase: "closing", message: intent.reason });
        handled = true;
      }
      return { handled, view };
  };
  return {
    dispatch,
    dispose() {
      if (disposed) return;
      disposed = true; lifetime.abort(); controlLifetime.abort(); generation++; controlGeneration++; playbackRecoveryUntil = 0;
      dependencies.browser.dispose?.();
      publish({ phase: "disposed" });
    },
  };
}
