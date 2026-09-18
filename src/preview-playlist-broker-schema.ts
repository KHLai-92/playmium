export type PlaylistBrokerRect = { left: number; top: number; width: number; height: number };

export type PlaylistBrokerMessage = {
  channel?: unknown;
  kind?: unknown;
  requestId?: unknown;
  videoId?: unknown;
  response?: unknown;
  error?: unknown;
  stage?: unknown;
  elapsedMs?: unknown;
  reason?: unknown;
  observedVideoId?: unknown;
  playabilityStatus?: unknown;
  hasStreamingData?: unknown;
};

export const playlistBrokerChannel = "skip-ads-preview-playlist-broker";
export const playlistBrokerRequestParameter = "skip_inline_preview_broker";
export const playlistBrokerVideoParameter = "skip_inline_preview_video";
// Temporary opt-in for live ID-versus-URL measurements in the actual iframe.
export const playlistBrokerSearchModeParameter = "skip_inline_preview_search";

export function playlistBrokerSearchQuery(videoId: string, currentQuery = "", useUrl = false) {
  if (useUrl) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    return currentQuery === url ? `"${url}"` : url;
  }
  const primary = videoId.startsWith("-") ? `"${videoId}"` : videoId;
  if (currentQuery !== primary) return primary;
  return videoId.startsWith("-") ? `${primary} youtube` : `"${videoId}"`;
}

export function isPlaylistBrokerVideoId(value: unknown): value is string {
  return typeof value === "string" && /^[\w-]{11}$/.test(value);
}

export function isPlaylistBrokerRequest(message: PlaylistBrokerMessage): message is PlaylistBrokerMessage & {
  channel: string; kind: "prepare"; requestId: string; videoId: string;
} {
  return message?.channel === playlistBrokerChannel && message.kind === "prepare" &&
    typeof message.requestId === "string" && message.requestId.length <= 100 &&
    isPlaylistBrokerVideoId(message.videoId);
}

export function isPlaylistBrokerCancel(message: PlaylistBrokerMessage): message is PlaylistBrokerMessage & {
  channel: string; kind: "cancel"; requestId: string; videoId: string;
} {
  return message?.channel === playlistBrokerChannel && message.kind === "cancel" &&
    typeof message.requestId === "string" && message.requestId.length <= 100 &&
    isPlaylistBrokerVideoId(message.videoId);
}

export function isPlaylistBrokerRewake(message: PlaylistBrokerMessage): message is PlaylistBrokerMessage & {
  channel: string; kind: "rewake"; requestId: string; videoId: string;
} {
  return message?.channel === playlistBrokerChannel && message.kind === "rewake" &&
    typeof message.requestId === "string" && message.requestId.length <= 100 &&
    isPlaylistBrokerVideoId(message.videoId);
}

export function isPlaylistBrokerResponse(message: PlaylistBrokerMessage, requestId: string, videoId: string): boolean {
  return message?.channel === playlistBrokerChannel && message.requestId === requestId && message.videoId === videoId &&
    ["ready", "request", "request-observed", "click", "response", "invalid", "error"].includes(String(message.kind));
}
