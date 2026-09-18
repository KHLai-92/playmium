type Runtime = Readonly<{
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
}>;

type HoverCandidate = Readonly<{
  videoId: string;
  action: () => void;
}>;

/** Delays hover-only playlist work until the pointer has stopped moving across rows. */
export function createPlaylistHoverIntent(runtime: Runtime, options: { delayMs?: number } = {}) {
  const delayMs = options.delayMs ?? 100;
  let pending: { videoId?: string; timer: unknown } | null = null;

  const cancel = () => {
    if (!pending) return;
    runtime.cancel(pending.timer);
    pending = null;
  };

  return {
    enter(videoId: string, action: () => void) {
      cancel();
      const candidate: { videoId: string; timer: unknown } = {
        videoId,
        timer: null,
      };
      candidate.timer = runtime.schedule(() => {
        if (pending !== candidate) return;
        pending = null;
        action();
      }, delayMs);
      pending = candidate;
    },
    settleAfterActivity(resolve: () => HoverCandidate | null) {
      cancel();
      const recovery: { timer: unknown } = { timer: null };
      recovery.timer = runtime.schedule(() => {
        if (pending !== recovery) return;
        pending = null;
        resolve()?.action();
      }, delayMs);
      pending = recovery;
    },
    leave(videoId: string) {
      if (pending?.videoId === videoId) cancel();
    },
    cancel,
  };
}
