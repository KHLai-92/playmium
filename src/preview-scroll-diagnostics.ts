export type PlaylistScrollSnapshot = Readonly<{
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}>;

export type PlaylistWheelSample = Readonly<{
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  clientX: number;
  clientY: number;
  target: string;
  path: readonly string[];
  isTrusted: boolean;
  observedScrollBeforeDispatch?: Readonly<{ from: number; to: number; ageMs: number }>;
}>;

export type PlaylistScrollBurst = Readonly<{
  outcome: "moved" | "stalled" | "boundary" | "neutral";
  events: number;
  durationMs: number;
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  direction: "up" | "down" | "neutral";
  expectedMovement: boolean;
  movementPx: number;
  before: PlaylistScrollSnapshot;
  after: PlaylistScrollSnapshot;
  defaultPreventedEvents: number;
  propagationStoppedEvents: number;
  pointer: Readonly<{ x: number; y: number }>;
  target: string;
  path: readonly string[];
  isTrusted: boolean;
  observedScrollBeforeDispatch: Readonly<{ from: number; to: number; ageMs: number }> | null;
}>;

type Runtime = Readonly<{
  now(): number;
  schedule(callback: () => void, milliseconds: number): unknown;
  cancel(timer: unknown): void;
  onBurst(result: PlaylistScrollBurst): void;
}>;

const rounded = (value: number) => Math.round(value * 10) / 10;
const maxScrollTop = (snapshot: PlaylistScrollSnapshot) => Math.max(0, snapshot.scrollHeight - snapshot.clientHeight);

/** Coalesces a wheel gesture so diagnostics emit once after input settles, not once per wheel event. */
export function createPlaylistScrollDiagnostics(runtime: Runtime, options: { settleMs?: number; movementThresholdPx?: number } = {}) {
  const settleMs = options.settleMs ?? 160;
  const movementThresholdPx = options.movementThresholdPx ?? 1;
  type Burst = {
    startedAt: number;
    before: PlaylistScrollSnapshot;
    latest: PlaylistScrollSnapshot;
    minScrollTop: number;
    maxScrollTop: number;
    events: number;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    defaultPreventedEvents: number;
    propagationStoppedEvents: number;
    sample: PlaylistWheelSample;
  };
  let burst: Burst | null = null;
  let timer: unknown = null;

  const finish = (snapshot?: PlaylistScrollSnapshot) => {
    if (timer !== null) runtime.cancel(timer);
    timer = null;
    const current = burst;
    burst = null;
    if (!current) return;
    const after = snapshot ?? current.latest;
    const direction = current.deltaY > 0 ? "down" : current.deltaY < 0 ? "up" : "neutral";
    const boundary = direction === "down"
      ? current.before.scrollTop >= maxScrollTop(current.before) - movementThresholdPx
      : direction === "up" ? current.before.scrollTop <= movementThresholdPx : false;
    const movement = Math.max(
      Math.abs(after.scrollTop - current.before.scrollTop),
      current.maxScrollTop - current.minScrollTop,
    );
    const expectedMovement = direction !== "neutral" && !boundary;
    const outcome = direction === "neutral" ? "neutral" : boundary ? "boundary" :
      movement >= movementThresholdPx ? "moved" : "stalled";
    runtime.onBurst({
      outcome,
      events: current.events,
      durationMs: rounded(runtime.now() - current.startedAt),
      deltaX: rounded(current.deltaX),
      deltaY: rounded(current.deltaY),
      deltaMode: current.deltaMode,
      direction,
      expectedMovement,
      movementPx: rounded(movement),
      before: current.before,
      after,
      defaultPreventedEvents: current.defaultPreventedEvents,
      propagationStoppedEvents: current.propagationStoppedEvents,
      pointer: { x: current.sample.clientX, y: current.sample.clientY },
      target: current.sample.target,
      path: current.sample.path,
      isTrusted: current.sample.isTrusted,
      observedScrollBeforeDispatch: current.sample.observedScrollBeforeDispatch ?? null,
    });
  };

  const scheduleFinish = () => {
    if (timer !== null) runtime.cancel(timer);
    timer = runtime.schedule(() => finish(), settleMs);
  };

  return {
    wheel(sample: PlaylistWheelSample, snapshot: PlaylistScrollSnapshot) {
      if (!burst) {
        burst = {
          startedAt: runtime.now(), before: { ...snapshot }, latest: { ...snapshot },
          minScrollTop: snapshot.scrollTop, maxScrollTop: snapshot.scrollTop,
          events: 0, deltaX: 0, deltaY: 0, deltaMode: sample.deltaMode,
          defaultPreventedEvents: 0, propagationStoppedEvents: 0, sample,
        };
      }
      burst.events++;
      burst.deltaX += sample.deltaX;
      burst.deltaY += sample.deltaY;
      burst.deltaMode = sample.deltaMode;
      burst.latest = { ...snapshot };
      burst.sample = sample;
      scheduleFinish();
    },
    scroll(snapshot: PlaylistScrollSnapshot) {
      if (!burst) return;
      burst.latest = { ...snapshot };
      burst.minScrollTop = Math.min(burst.minScrollTop, snapshot.scrollTop);
      burst.maxScrollTop = Math.max(burst.maxScrollTop, snapshot.scrollTop);
    },
    noteDisposition(defaultPrevented: boolean, propagationStopped: boolean) {
      if (!burst) return;
      if (defaultPrevented) burst.defaultPreventedEvents++;
      if (propagationStopped) burst.propagationStoppedEvents++;
    },
    flush: finish,
  };
}
