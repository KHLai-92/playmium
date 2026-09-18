export type PageBridgeErrorCode = "invalid-request" | "invalid-response" | "stale-target" | "timeout" | "cancelled" | "unavailable" | "operation-failed";

export class PageBridgeError extends Error {
  readonly code: PageBridgeErrorCode;
  constructor(code: PageBridgeErrorCode, message: string) { super(message); this.name = "PageBridgeError"; this.code = code; }
}

type OperationShape = Record<string, { input: unknown; output: unknown }>;
export type PageBridgeRequestOptions<Output> = Readonly<{
  signal?: AbortSignal;
  onProgress?: (output: Output) => void;
}>;
export type PageBridge<Operations extends OperationShape, Target> = Readonly<{
  request<K extends keyof Operations>(target: Target, operation: K, input: Operations[K]["input"], options?: PageBridgeRequestOptions<Operations[K]["output"]>): Promise<Operations[K]["output"]>;
}>;

type DomOperation = Readonly<{ requestEvent: string; responseEvent: string; timeoutMs: number; validate(output: unknown): boolean }>;
type DomOperations<Operations extends OperationShape> = { [K in keyof Operations]: DomOperation };

function createRequestSettlement(signal: AbortSignal | undefined, reject: (reason: PageBridgeError) => void) {
  let settled = false;
  let cleanup = () => {};
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    signal?.removeEventListener("abort", cancel);
    cleanup();
    callback();
  };
  const cancel = () => finish(() => reject(new PageBridgeError("cancelled", "Page request was cancelled.")));
  signal?.addEventListener("abort", cancel, { once: true });
  return { finish, isActive: () => !settled, setCleanup(value: () => void) { cleanup = value; } };
}

let requestSequence = 0;
export function createDomPageBridge<Operations extends OperationShape>(
  operations: DomOperations<Operations>,
  platform: { CustomEvent: typeof CustomEvent } = { CustomEvent },
): PageBridge<Operations, EventTarget> {
  return {
    request(target, operation, input, options) {
      const config = operations[operation];
      if (!config) return Promise.reject(new PageBridgeError("invalid-request", "Unknown page operation."));
      if (!(target instanceof EventTarget) && typeof (target as EventTarget)?.dispatchEvent !== "function") {
        return Promise.reject(new PageBridgeError("stale-target", "Page request target is unavailable."));
      }
      if (options?.signal?.aborted) return Promise.reject(new PageBridgeError("cancelled", "Page request was cancelled."));
      const requestId = `${Date.now()}-${++requestSequence}`;
      return new Promise((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout>;
        const settlement = createRequestSettlement(options?.signal, reject);
        const receive = (event: Event) => {
          if (event.target !== target) return;
          let response: { requestId?: unknown; output?: unknown; error?: unknown; progress?: unknown };
          try { response = JSON.parse((event as CustomEvent).detail); }
          catch { return settlement.finish(() => reject(new PageBridgeError("invalid-response", "Page response was malformed."))); }
          if (response.requestId !== requestId) return;
          if (response.error) return settlement.finish(() => reject(new PageBridgeError("operation-failed", String(response.error))));
          if (!config.validate(response.output)) return settlement.finish(() => reject(new PageBridgeError("invalid-response", "Page response failed validation.")));
          if (response.progress === true) {
            options?.onProgress?.(response.output as Operations[keyof Operations]["output"]);
            return;
          }
          settlement.finish(() => resolve(response.output as Operations[keyof Operations]["output"]));
        };
        target.addEventListener(config.responseEvent, receive);
        settlement.setCleanup(() => { clearTimeout(timer); target.removeEventListener(config.responseEvent, receive); });
        timer = setTimeout(() => settlement.finish(() => reject(new PageBridgeError("timeout", "Page request timed out."))), config.timeoutMs);
        try {
          target.dispatchEvent(new platform.CustomEvent(config.requestEvent, { bubbles: true, detail: JSON.stringify({ requestId, input }) }));
        } catch {
          settlement.finish(() => reject(new PageBridgeError("unavailable", "Page transport is unavailable.")));
        }
      }) as Promise<Operations[typeof operation]["output"]>;
    },
  };
}

export function createInMemoryPageBridge<Operations extends OperationShape>(handlers: {
  [K in keyof Operations]: (
    input: Operations[K]["input"],
    target: object,
    context: Readonly<{ signal?: AbortSignal; progress(output: Operations[K]["output"]): void }>,
  ) => Operations[K]["output"] | Promise<Operations[K]["output"]>
}): PageBridge<Operations, object> {
  return {
    request(target, operation, input, options) {
      if (options?.signal?.aborted) return Promise.reject(new PageBridgeError("cancelled", "Page request was cancelled."));
      const handler = handlers[operation];
      if (!handler) return Promise.reject(new PageBridgeError("invalid-request", "Unknown page operation."));
      return new Promise<Operations[typeof operation]["output"]>((resolve, reject) => {
        const settlement = createRequestSettlement(options?.signal, reject);
        const context = {
          signal: options?.signal,
          progress(output: Operations[typeof operation]["output"]) {
            if (settlement.isActive()) options?.onProgress?.(output);
          },
        };
        void Promise.resolve().then(() => handler(input, target, context)).then(
          output => settlement.finish(() => resolve(output)),
          error => settlement.finish(() => reject(error instanceof PageBridgeError ? error : new PageBridgeError(
            "operation-failed", error instanceof Error ? error.message : "Page operation failed.",
          ))),
        );
      });
    },
  };
}
