import { previewPageOperations, type PreviewPageOperationConfig } from "./preview-page-operations";

export function installPreviewPageBridge() {
  if (window !== window.top || typeof AbortController === "undefined" || typeof document.addEventListener !== "function") return { dispose() {} };
  const lifetime = new AbortController();
  for (const config of Object.values(previewPageOperations) as PreviewPageOperationConfig<unknown>[]) {
    document.addEventListener(config.requestEvent, event => {
      const target = event.target;
      if (!(target instanceof EventTarget)) return;
      let request: { requestId?: unknown; input?: unknown };
      try { request = JSON.parse((event as CustomEvent).detail); } catch { return; }
      if (typeof request.requestId !== "string" || request.requestId.length > 100) return;
      const respond = (output: unknown, error = "", progress = false) => target.dispatchEvent(new CustomEvent(config.responseEvent, {
        detail: JSON.stringify({ requestId: request.requestId, output, error, progress }),
      }));
      const receive = (responseEvent: Event) => {
        if (responseEvent.target !== target) return;
        let output: unknown;
        try { output = JSON.parse((responseEvent as CustomEvent).detail); }
        catch { return; }
        if (!config.matchesLegacyResponse(request.input, output)) return;
        if (!config.validate(output)) {
          clearTimeout(timeout);
          target.removeEventListener(config.legacyResponseEvent, receive);
          respond(null, "Page operation returned an invalid response.");
          return;
        }
        const disposition = config.legacyResponseDisposition(output);
        if (disposition === "ignore") return;
        if (disposition === "progress") {
          respond(output, "", true);
          return;
        }
        clearTimeout(timeout);
        target.removeEventListener(config.legacyResponseEvent, receive);
        respond(output);
      };
      target.addEventListener(config.legacyResponseEvent, receive);
      const timeout = setTimeout(() => {
        target.removeEventListener(config.legacyResponseEvent, receive);
        respond(null, "Page operation timed out.");
      }, config.timeoutMs);
      target.dispatchEvent(new CustomEvent(config.legacyRequestEvent, { bubbles: true, detail: JSON.stringify(request.input) }));
    }, { capture: true, signal: lifetime.signal });
  }
  return { dispose() { lifetime.abort(); } };
}
