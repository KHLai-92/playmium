export type WatchPageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export function fetchWatchPageSource(
  fetchPage: WatchPageFetch,
  url: string,
  ownerSignal: AbortSignal,
  timeoutSignal: AbortSignal = AbortSignal.timeout(15_000),
) {
  return fetchPage(url, {
    credentials: "same-origin",
    signal: AbortSignal.any([ownerSignal, timeoutSignal]),
  });
}
