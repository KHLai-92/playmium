export const playlistRequestEvent = "skip-ads-preview-playlist-request";
export const playlistResponseEvent = "skip-ads-preview-playlist-response";
export const playlistSelectEvent = "skip-ads-preview-playlist-select";
export const playlistSelectPhaseEvent = "skip-ads-preview-playlist-select-phase";
export const playlistPrefetchEvent = "skip-ads-preview-playlist-prefetch";
export const playlistPrefetchCancelEvent = "skip-ads-preview-playlist-prefetch-cancel";
export const playlistPreviewRetentionEvent = "skip-ads-preview-playlist-retention";
export const playlistPreviewWarmPhaseEvent = "skip-ads-preview-playlist-warm-phase";
export const playlistWarmEvent = "skip-ads-preview-playlist-warm";
export const playlistFirstVideoRequestEvent = "skip-ads-preview-playlist-first-video-request";
export const playlistFirstVideoResponseEvent = "skip-ads-preview-playlist-first-video-response";
export const playlistAudioChangeEvent = "skip-ads-preview-playlist-audio-change";
export const playlistBrokerClickEvent = "skip-ads-preview-playlist-broker-click";
// Hover intent is delayed and the broker permits one current logical job, so
// preparing the row under the pointer can hide search latency without scaling
// resource use with playlist length.
export const retainPlaylistPreviews = true;
// Hover preparation and completed-response retention are separate policies.
// Keep hover preparation enabled and retain a small, user-configurable LRU.
export const playlistPreviewRetentionCapacity = 1;
export const minimumPlaylistPreviewRetentionCapacity = 1;
export const maximumPlaylistPreviewRetentionCapacity = 3;
export const playlistPreviewRetentionTtlMs = 30_000;
export const defaultPlaylistStageRetryLimit = 2;
export const minimumPlaylistStageRetryLimit = 0;
export const maximumPlaylistStageRetryLimit = 2;
export const defaultPlaylistAutoplayEnabled = false;
export const playlistDrawerRightInset = 12;
export type PlaylistPreviewTrigger = "hover" | "focus" | "click";
export type PlaylistBrokerStage = "starting" | "ready" | "request";
export type PlaylistBrokerTimeoutMultipliers = Record<PlaylistBrokerStage, number>;
export const playlistBrokerTimeoutBaselinesMs: Readonly<Record<PlaylistBrokerStage, number>> = {
  starting: 5_000,
  ready: 1_500,
  request: 4_000,
};
export const playlistBrokerTimeoutSecondsRanges: Readonly<Record<PlaylistBrokerStage, Readonly<{ min: number; max: number }>>> = {
  starting: { min: 3, max: 8 },
  ready: { min: .8, max: 2.5 },
  request: { min: 2, max: 6 },
};
export const playlistBrokerTimeoutSecondsStep = .1;
// Multipliers remain an internal transport/storage format so existing saved
// preferences stay compatible. The control panel exposes bounded seconds.
export const minimumPlaylistBrokerTimeoutMultiplier = .5;
export const maximumPlaylistBrokerTimeoutMultiplier = 3;
export const defaultPlaylistBrokerTimeoutMultipliers: PlaylistBrokerTimeoutMultipliers = {
  starting: 1,
  ready: 1,
  request: 1,
};

type PlaylistPreferenceStorage = Readonly<{
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}>;

export function normalizePlaylistPreviewRetentionCapacity(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return playlistPreviewRetentionCapacity;
  return Math.min(maximumPlaylistPreviewRetentionCapacity,
    Math.max(minimumPlaylistPreviewRetentionCapacity, Math.round(parsed)));
}

export async function loadPlaylistPreviewRetentionCapacity(storage: PlaylistPreferenceStorage, key: string): Promise<number> {
  const values = await storage.get(key);
  return normalizePlaylistPreviewRetentionCapacity(values[key]);
}

export function savePlaylistPreviewRetentionCapacity(storage: PlaylistPreferenceStorage, key: string, capacity: number) {
  return storage.set({ [key]: normalizePlaylistPreviewRetentionCapacity(capacity) });
}

export function normalizePlaylistStageRetryLimit(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return defaultPlaylistStageRetryLimit;
  return Math.min(maximumPlaylistStageRetryLimit, Math.max(minimumPlaylistStageRetryLimit, Math.round(parsed)));
}

export async function loadPlaylistStageRetryLimit(storage: PlaylistPreferenceStorage, key: string): Promise<number> {
  const values = await storage.get(key);
  return normalizePlaylistStageRetryLimit(values[key]);
}

export function savePlaylistStageRetryLimit(storage: PlaylistPreferenceStorage, key: string, limit: number) {
  return storage.set({ [key]: normalizePlaylistStageRetryLimit(limit) });
}

export async function loadPlaylistAutoplayPreference(storage: PlaylistPreferenceStorage, key: string): Promise<boolean> {
  const values = await storage.get(key);
  return typeof values[key] === "boolean" ? values[key] : defaultPlaylistAutoplayEnabled;
}

export function savePlaylistAutoplayPreference(storage: PlaylistPreferenceStorage, key: string, enabled: boolean) {
  return storage.set({ [key]: Boolean(enabled) });
}

export function normalizePlaylistBrokerTimeoutMultiplier(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return 1;
  const bounded = Math.min(maximumPlaylistBrokerTimeoutMultiplier, Math.max(minimumPlaylistBrokerTimeoutMultiplier, parsed));
  return Math.round(bounded * 10_000) / 10_000;
}

export function normalizePlaylistBrokerTimeoutMultipliers(value: unknown): PlaylistBrokerTimeoutMultipliers {
  const input = value && typeof value === "object" ? value as Partial<Record<PlaylistBrokerStage, unknown>> : {};
  return {
    starting: normalizePlaylistBrokerTimeoutMultiplier(input.starting),
    ready: normalizePlaylistBrokerTimeoutMultiplier(input.ready),
    request: normalizePlaylistBrokerTimeoutMultiplier(input.request),
  };
}

export function playlistBrokerStageTimeoutMs(stage: PlaylistBrokerStage, multipliers: PlaylistBrokerTimeoutMultipliers): number {
  return Math.round(playlistBrokerTimeoutBaselinesMs[stage] * normalizePlaylistBrokerTimeoutMultiplier(multipliers[stage]));
}

export function normalizePlaylistBrokerTimeoutSeconds(stage: PlaylistBrokerStage, value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  const fallback = playlistBrokerTimeoutBaselinesMs[stage] / 1000;
  const range = playlistBrokerTimeoutSecondsRanges[stage];
  const bounded = Math.min(range.max, Math.max(range.min, Number.isFinite(parsed) ? parsed : fallback));
  return Math.round(bounded * 10) / 10;
}

export function playlistBrokerTimeoutMultiplierForSeconds(stage: PlaylistBrokerStage, value: unknown): number {
  return normalizePlaylistBrokerTimeoutMultiplier(
    normalizePlaylistBrokerTimeoutSeconds(stage, value) * 1000 / playlistBrokerTimeoutBaselinesMs[stage]);
}

export function playlistBrokerTimeoutSeconds(stage: PlaylistBrokerStage, multipliers: PlaylistBrokerTimeoutMultipliers): number {
  return normalizePlaylistBrokerTimeoutSeconds(stage, playlistBrokerStageTimeoutMs(stage, multipliers) / 1000);
}

export function normalizePlaylistBrokerTimeoutSettings(value: unknown): PlaylistBrokerTimeoutMultipliers {
  const multipliers = normalizePlaylistBrokerTimeoutMultipliers(value);
  return {
    starting: playlistBrokerTimeoutMultiplierForSeconds("starting", playlistBrokerTimeoutSeconds("starting", multipliers)),
    ready: playlistBrokerTimeoutMultiplierForSeconds("ready", playlistBrokerTimeoutSeconds("ready", multipliers)),
    request: playlistBrokerTimeoutMultiplierForSeconds("request", playlistBrokerTimeoutSeconds("request", multipliers)),
  };
}

export async function loadPlaylistBrokerTimeoutMultipliers(storage: PlaylistPreferenceStorage, key: string) {
  const values = await storage.get(key);
  return normalizePlaylistBrokerTimeoutMultipliers(values[key]);
}

export function savePlaylistBrokerTimeoutMultipliers(storage: PlaylistPreferenceStorage, key: string,
    multipliers: PlaylistBrokerTimeoutMultipliers) {
  return storage.set({ [key]: normalizePlaylistBrokerTimeoutMultipliers(multipliers) });
}

export type PreviewPlaylistItem = {
  videoId: string;
  title: string;
  channel: string;
  duration: string;
  thumbnail: string;
};

export type PreviewPlaylist = {
  playlistId: string;
  source: string;
  videoId: string;
  title: string;
  currentIndex: number;
  items: PreviewPlaylistItem[];
  error: string;
};

export type PreviewPlaylistSeed = {
  title: string;
  items: PreviewPlaylistItem[];
};

export type PreviewPlaylistSeedLink = {
  href: string;
  label: string;
  thumbnail?: string;
};

export type PlaylistPlaybackAudioState = {
  playerMuted: boolean;
  playerVolume: number | undefined;
  nativeMuted: boolean;
  nativeVolume: number;
};

export function playlistPlaybackAudioState(
  playerMuted: boolean | undefined,
  playerVolume: number | undefined,
  nativeMuted: boolean,
  nativeVolume: number,
): PlaylistPlaybackAudioState {
  return {
    playerMuted: playerMuted ?? nativeMuted,
    playerVolume: typeof playerVolume === "number" && Number.isFinite(playerVolume) ? playerVolume : undefined,
    nativeMuted,
    nativeVolume,
  };
}

/**
 * Shares playlist discovery started at thumbnail-click time with the later
 * pinned-player request. Rejected and unparseable responses are evicted so a
 * visible retry can perform fresh work instead of inheriting a dead promise.
 */
export function createPlaylistLoadCoordinator(
  fetchPlaylist: (videoId: string, playlistId: string) => Promise<PreviewPlaylist | null>,
) {
  const cache = new Map<string, Promise<PreviewPlaylist>>();
  const load = (videoId: string, playlistId: string): Promise<PreviewPlaylist> => {
    const key = `${videoId}:${playlistId}`;
    const existing = cache.get(key);
    if (existing) return existing;
    const request = fetchPlaylist(videoId, playlistId).then(result => {
      if (!result) throw new Error("Playlist information is unavailable.");
      return result;
    });
    cache.set(key, request);
    void request.catch(() => { if (cache.get(key) === request) cache.delete(key); });
    return request;
  };
  return { prime: load, load };
}

export function bindPlaylistSource(playlist: PreviewPlaylist, source: string): PreviewPlaylist {
  return { ...playlist, source };
}

export type PlaylistGeometryInput = {
  playerLeft: number;
  playerTop: number;
  playerWidth: number;
  playerHeight: number;
};

/**
 * The playlist entrance is flush with the player's right edge. The expanded
 * drawer uses the same 12px right inset as the description/comments panel.
 */
export function playlistGeometry({
  playerLeft,
  playerTop,
  playerWidth,
  playerHeight,
}: PlaylistGeometryInput) {
  const handleWidth = Math.min(58, Math.max(36, playerWidth));
  const drawerWidth = Math.max(0, Math.min(380, playerWidth - playlistDrawerRightInset * 2));
  const drawerHeight = Math.max(0, Math.min(620, playerHeight - 28, playerHeight * .72));
  const handleHeight = Math.max(0, Math.min(560, playerHeight - 28, playerHeight * .68));
  const playerRight = playerLeft + playerWidth;
  const drawerRight = playerRight - playlistDrawerRightInset;
  return {
    playerWidth,
    drawerRightInset: playlistDrawerRightInset,
    handleWidth,
    handleLeft: playerRight - handleWidth,
    handleTop: playerTop + (playerHeight - handleHeight) * .56,
    handleHeight,
    drawerWidth,
    drawerLeft: drawerRight - drawerWidth,
    drawerTop: playerTop + (playerHeight - drawerHeight) * .54,
    drawerHeight,
  };
}

export function nextPlaylistAutoplayVideoId(playlist: Pick<PreviewPlaylist, "currentIndex" | "items"> | null): string | null {
  if (!playlist || !Number.isInteger(playlist.currentIndex) || playlist.currentIndex < 0) return null;
  return playlist.items[playlist.currentIndex + 1]?.videoId ?? null;
}

export function playlistAutoplayPreparation(
  state: "preparing" | "ready" | "error" | undefined,
  actionId: string | undefined,
): Readonly<{ mode: "warm"; actionId: string } | { mode: "cold"; actionId: undefined }> {
  return state === "ready" && actionId
    ? { mode: "warm", actionId }
    : { mode: "cold", actionId: undefined };
}


/**
 * A playlist is eligible only when YouTube rendered a collection object and
 * its primary watch endpoint carries a playlist id. This intentionally avoids
 * translated badge text and rejects ordinary recommendation renderers even if
 * their watch URL happens to contain a list parameter.
 */
export function collectionPlaylistId(href: string, isCollection: boolean, base = "https://www.youtube.com/"): string | null {
  if (!isCollection) return null;
  try {
    const url = new URL(href, base);
    const playlistId = url.searchParams.get("list");
    return url.pathname === "/watch" && playlistId && isPlaylistId(playlistId) ? playlistId : null;
  } catch { return null; }
}

export function isPlaylistId(value: string): boolean {
  return /^[\w-]{2,120}$/.test(value);
}
export function firstPlaylistVideoId(data: unknown): string | null {
  const stack: unknown[] = [data];
  let visited = 0;

  while (stack.length && visited++ < 100000) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;

    const record = value as Record<string, any>;
    const renderer = record.playlistVideoRenderer ?? record.playlistPanelVideoRenderer;
    const videoId = renderer?.videoId;

    if (typeof videoId === "string" && /^[\w-]{11}$/.test(videoId)) return videoId;

    const children = Object.values(record);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }

  return null;
}

export function playlistSeedFromLinks(
  title: string,
  links: PreviewPlaylistSeedLink[],
  videoId: string,
  playlistId: string,
  base = "https://www.youtube.com/",
): PreviewPlaylistSeed | null {
  if (!/^[\w-]{11}$/.test(videoId) || !isPlaylistId(playlistId) || !Array.isArray(links)) return null;
  const items = new Map<string, PreviewPlaylistItem>();
  for (const link of links.slice(0, 20)) {
    if (!link || typeof link.href !== "string" || typeof link.label !== "string") continue;
    let url: URL;
    try { url = new URL(link.href, base); } catch { continue; }
    const candidateId = url.pathname === "/watch" && url.searchParams.get("list") === playlistId ? url.searchParams.get("v") : null;
    if (!candidateId || !/^[\w-]{11}$/.test(candidateId)) continue;
    const label = link.label.replace(/\s+/g, " ").trim();
    const duration = label.match(/(?:·|•)\s*(\d+(?::\d+){1,2})\s*$/)?.[1] ?? "";
    const item = { videoId: candidateId,
      title: label.replace(/\s*(?:·|•)\s*\d+(?::\d+){1,2}\s*$/, "").trim().slice(0, 300),
      channel: "", duration, thumbnail: safeThumbnail(link.thumbnail) };
    if (!item.title) continue;
    const previous = items.get(candidateId);
    if (!previous || item.title.length > previous.title.length) items.set(candidateId, item);
  }
  const normalized = [...items.values()];
  if (normalized.length < 2 || !items.has(videoId)) return null;
  const linkTitle = links
    .map(link => typeof link?.label === "string" ? link.label.replace(/\s+/g, " ").trim() : "")
    .filter(label => label && label.length <= 100 && !/(?:·|•)\s*\d+(?::\d+){1,2}\s*$/.test(label))
    .sort((left, right) => right.length - left.length)[0];
  const suppliedTitle = typeof title === "string" ? title.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return { title: linkTitle || suppliedTitle, items: normalized };
}

export function normalizePlaylistSeed(value: unknown, videoId: string): PreviewPlaylistSeed | null {
  const seed = value as any;
  if (!seed || typeof seed !== "object" || typeof seed.title !== "string" || !Array.isArray(seed.items)) return null;
  const links = seed.items.map((item: any) => ({
    href: `/watch?v=${typeof item?.videoId === "string" ? encodeURIComponent(item.videoId) : ""}&list=seed`,
    label: `${typeof item?.title === "string" ? item.title : ""}${typeof item?.duration === "string" && item.duration ? ` · ${item.duration}` : ""}`,
    thumbnail: typeof item?.thumbnail === "string" ? item.thumbnail : "",
  }));
  const normalized = playlistSeedFromLinks(seed.title, links, videoId, "seed");
  if (!normalized) return null;
  const channels = new Map<string, string>();
  for (const item of seed.items) {
    if (typeof item?.videoId === "string") channels.set(item.videoId,
      typeof item?.channel === "string" ? item.channel.replace(/\s+/g, " ").trim().slice(0, 160) : "");
  }
  normalized.items = normalized.items.map(item => ({ ...item, channel: channels.get(item.videoId) ?? "" }));
  return normalized;
}

/** Validate that the broker returned playable data for the requested video. */
export function validatedPlaylistPlayerResponse(value: unknown, videoId: string): any | null {
  if (!value || typeof value !== "object" || !/^[\w-]{11}$/.test(videoId)) return null;
  const response = value as any;
  if (response.playabilityStatus?.status !== "OK" || response.videoDetails?.videoId !== videoId ||
      !response.streamingData || typeof response.streamingData !== "object") return null;
  return response;
}

export function isPlaybackTroubleNotification(value: unknown): boolean {
  const urlValue = (value as any)?.actionButton?.buttonRenderer?.navigationEndpoint?.urlEndpoint?.url ??
    (value as any)?.actionButton?.buttonRenderer?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url;
  if (typeof urlValue !== "string") return false;
  try {
    const url = new URL(urlValue);
    return url.hostname === "support.google.com" && url.pathname === "/youtube/answer/3037019" &&
      `${url.hash}${url.search}`.includes("check_ad_blockers");
  } catch { return false; }
}

function safeThumbnail(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)(ytimg\.com|ggpht\.com)$/.test(url.hostname) ? url.href : "";
  } catch { return ""; }
}

function playlistText(value: any): string {
  if (typeof value === "string") return value;
  if (typeof value?.simpleText === "string") return value.simpleText;
  if (Array.isArray(value?.runs)) return value.runs.map((run: any) => typeof run?.text === "string" ? run.text : "").join("");
  return "";
}

export function extractPlaylist(data: unknown, videoId: string, playlistId: string, source = "", seedValue?: PreviewPlaylistSeed): PreviewPlaylist | null {
  const seed = normalizePlaylistSeed(seedValue, videoId);
  const stack: any[] = [data];
  let panel: any = null;
  const looseRenderers: any[] = [];
  let visited = 0;
  while (stack.length && visited++ < 100000) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (value.playlistPanelRenderer?.contents) panel ??= value.playlistPanelRenderer;
    if (value.playlistPanelVideoRenderer) looseRenderers.push(value.playlistPanelVideoRenderer);
    const children = Object.values(value);
    for (let index = children.length - 1; index >= 0; index--) stack.push(children[index]);
  }
  const renderers = panel ? (panel.contents ?? []).map((entry: any) => entry?.playlistPanelVideoRenderer) : looseRenderers;
  const items: PreviewPlaylistItem[] = seed ? seed.items.map(item => ({ ...item })) : [];
  const seen = new Set<string>();
  for (const item of items) seen.add(item.videoId);
  for (const renderer of renderers) {
    if (!renderer || !/^[\w-]{11}$/.test(renderer.videoId ?? "")) continue;
    if (seen.has(renderer.videoId)) {
      const existing = items.find(item => item.videoId === renderer.videoId)!;
      existing.channel ||= playlistText(renderer.shortBylineText ?? renderer.longBylineText).replace(/\s+/g, " ").trim().slice(0, 160);
      existing.duration ||= playlistText(renderer.lengthText).replace(/\s+/g, " ").trim().slice(0, 24);
      existing.thumbnail ||= safeThumbnail(renderer.thumbnail?.thumbnails?.at(-1)?.url);
      continue;
    }
    const title = playlistText(renderer.title).replace(/\s+/g, " ").trim().slice(0, 300);
    if (!title) continue;
    const thumbnail = safeThumbnail(renderer.thumbnail?.thumbnails?.at(-1)?.url);
    items.push({ videoId: renderer.videoId, title,
      channel: playlistText(renderer.shortBylineText ?? renderer.longBylineText).replace(/\s+/g, " ").trim().slice(0, 160),
      duration: playlistText(renderer.lengthText).replace(/\s+/g, " ").trim().slice(0, 24), thumbnail });
    seen.add(renderer.videoId);
    if (items.length >= 100) break;
  }
  const currentIndex = Math.max(0, items.findIndex(item => item.videoId === videoId));
  if (items.length < 2 || !items.some(item => item.videoId === videoId)) return null;
  return { playlistId, source, videoId, title: playlistText(panel?.title).replace(/\s+/g, " ").trim().slice(0, 300) || seed?.title || "Playlist",
    currentIndex, items, error: "" };
}
