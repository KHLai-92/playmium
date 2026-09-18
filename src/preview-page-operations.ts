import { type CaptionState, captionRequestEvent, captionResponseEvent } from "./preview-captions";
import { type InfoResponse, infoRequestEvent, infoResponseEvent } from "./preview-info";
import { type PreviewMetadata, metadataRequestEvent, metadataResponseEvent } from "./preview-metadata";
import {
  type PreviewPlaylist,
  type PreviewPlaylistSeed,
  type PlaylistBrokerTimeoutMultipliers,
  playlistPrefetchEvent,
  playlistPreviewWarmPhaseEvent,
  playlistRequestEvent,
  playlistResponseEvent,
  playlistSelectEvent,
  playlistSelectPhaseEvent,
  type PlaylistPreviewTrigger,
} from "./preview-playlist";
import { qualityLabels, type QualityState, qualityRequestEvent, qualityResponseEvent } from "./preview-quality";

export type PlaylistPrimePhase = Readonly<{
  actionId: string;
  trigger: PlaylistPreviewTrigger;
  videoId: string;
  phase: "idle" | "preparing" | "ready" | "error";
  error?: string;
}>;

export type PlaylistSelectPhase = Readonly<{
  requestId: string;
  actionId: string;
  videoId: string;
  playlistId: string;
  phase: "commit" | "playing" | "success" | "error";
  source?: string;
  quality?: string;
  layer?: string;
  error?: string;
}>;

export type PreviewPageOperations = {
  quality: { input: { source: string; quality?: string }; output: QualityState };
  captions: { input: { source: string; enabled?: boolean; track?: string; translation?: string }; output: CaptionState };
  metadata: { input: { source: string }; output: PreviewMetadata };
  info: { input: { source: string; requestId: number; kind: "description" | "comments"; token?: string }; output: InfoResponse };
  "playlist-prime": { input: { actionId: string; startedAtMs: number; trigger: PlaylistPreviewTrigger; videoId: string; playlistId: string;
    retentionCapacity: number; retryLimit: number; timeoutMultipliers: PlaylistBrokerTimeoutMultipliers;
    rect: { left: number; top: number; width: number; height: number } }; output: PlaylistPrimePhase };
  "playlist-load": { input: { source: string; videoId: string; playlistId: string; seed?: PreviewPlaylistSeed }; output: PreviewPlaylist };
  "playlist-select": { input: { source: string; actionId: string; startedAtMs: number; videoId: string; playlistId: string; requestId: string;
    retentionCapacity: number; retryLimit: number; timeoutMultipliers: PlaylistBrokerTimeoutMultipliers;
    rect: { left: number; top: number; width: number; height: number }; quality?: string }; output: PlaylistSelectPhase };
};

type LegacyResponseDisposition = "ignore" | "progress" | "final";
export type PreviewPageOperationConfig<Output> = Readonly<{
  requestEvent: string;
  responseEvent: string;
  legacyRequestEvent: string;
  legacyResponseEvent: string;
  timeoutMs: number;
  validate(value: unknown): value is Output;
  matchesLegacyResponse(input: unknown, output: unknown): boolean;
  legacyResponseDisposition(value: Output): LegacyResponseDisposition;
}>;

const objectWithString = (value: unknown, key: string): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && typeof (value as Record<string, unknown>)[key] === "string");
const objectRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object");
const stringField = (value: Record<string, unknown>, key: string) => typeof value[key] === "string";
const booleanField = (value: Record<string, unknown>, key: string) => typeof value[key] === "boolean";
const optionalStringField = (value: Record<string, unknown>, key: string) => !Object.hasOwn(value, key) || typeof value[key] === "string";
const matchesLegacyFields = (...keys: string[]) => (input: unknown, output: unknown) => objectRecord(input) && objectRecord(output) &&
  keys.every(key => Object.hasOwn(input, key) && Object.hasOwn(output, key) && input[key] === output[key]);
const qualityState = (value: unknown): value is QualityState => objectRecord(value) &&
  stringField(value, "source") && Array.isArray(value.available) && value.available.length <= 16 &&
  value.available.every(item => typeof item === "string" && Object.hasOwn(qualityLabels, item)) &&
  stringField(value, "current") && (value.requested === null || typeof value.requested === "string" && Object.hasOwn(qualityLabels, value.requested)) &&
  typeof value.requestedAt === "number" && Number.isFinite(value.requestedAt) && booleanField(value, "supported") && stringField(value, "error");
const captionState = (value: unknown): value is CaptionState => objectRecord(value) && stringField(value, "source") &&
  booleanField(value, "enabled") && booleanField(value, "available") && booleanField(value, "nativeSupported") &&
  stringField(value, "error") && stringField(value, "selectedTrack") && booleanField(value, "languageSupported") &&
  stringField(value, "translation") && Array.isArray(value.tracks) && value.tracks.length <= 64 &&
  value.tracks.every(track => objectRecord(track) && stringField(track, "id") && stringField(track, "label") && stringField(track, "languageCode")) &&
  Array.isArray(value.translations) && value.translations.length <= 256 &&
  value.translations.every(language => objectRecord(language) && stringField(language, "languageCode") && stringField(language, "label"));
const metadataState = (value: unknown): value is PreviewMetadata => objectRecord(value) && stringField(value, "videoId") &&
  stringField(value, "source") && stringField(value, "error") && Array.isArray(value.chapters) && value.chapters.length <= 500 &&
  value.chapters.every(chapter => objectRecord(chapter) && typeof chapter.title === "string" && chapter.title.length <= 400 &&
    typeof chapter.start === "number" && Number.isFinite(chapter.start) && chapter.start >= 0 && optionalStringField(chapter, "thumbnail"));
const richRun = (value: unknown) => objectRecord(value) && stringField(value, "text") && optionalStringField(value, "url") &&
  (!Object.hasOwn(value, "seek") || typeof value.seek === "number" && Number.isFinite(value.seek));
const description = (value: unknown) => objectRecord(value) && stringField(value, "title") && stringField(value, "author") &&
  optionalStringField(value, "authorUrl") && optionalStringField(value, "avatar") && stringField(value, "views") &&
  stringField(value, "published") && Array.isArray(value.runs) && value.runs.every(richRun);
const comment = (value: unknown, depth = 0): boolean => depth <= 8 && objectRecord(value) &&
  ["id", "author", "text", "published", "likes", "pinned", "replyLabel"].every(key => stringField(value, key)) &&
  optionalStringField(value, "authorUrl") && optionalStringField(value, "avatar") && optionalStringField(value, "replies") &&
  booleanField(value, "creator") && booleanField(value, "verified") && Array.isArray(value.inlineReplies) &&
  value.inlineReplies.every(reply => comment(reply, depth + 1));
const commentsPage = (value: unknown) => objectRecord(value) && Array.isArray(value.items) && value.items.every(item => comment(item)) &&
  optionalStringField(value, "next") && Array.isArray(value.sorts) && value.sorts.every(sort => objectRecord(sort) &&
    stringField(sort, "label") && stringField(sort, "token") && booleanField(sort, "selected")) &&
  stringField(value, "count") && stringField(value, "message");
const infoState = (value: unknown): value is InfoResponse => objectRecord(value) && Number.isSafeInteger(value.requestId) &&
  stringField(value, "videoId") && stringField(value, "source") && stringField(value, "error") &&
  (!Object.hasOwn(value, "description") || description(value.description)) &&
  (!Object.hasOwn(value, "comments") || commentsPage(value.comments));
const playlistItem = (value: unknown) => objectRecord(value) &&
  ["videoId", "title", "channel", "duration", "thumbnail"].every(key => stringField(value, key));
const playlist = (value: unknown): value is PreviewPlaylist => objectRecord(value) && stringField(value, "source") &&
  stringField(value, "playlistId") && stringField(value, "videoId") && stringField(value, "title") &&
  Number.isSafeInteger(value.currentIndex) && Array.isArray(value.items) && value.items.every(playlistItem) && stringField(value, "error");
const primePhase = (value: unknown): value is PlaylistPrimePhase => objectWithString(value, "videoId") &&
  typeof value.actionId === "string" && ["hover", "focus", "click"].includes(String(value.trigger)) &&
  ["idle", "preparing", "ready", "error"].includes(String(value.phase)) && optionalStringField(value, "error");
const selectPhase = (value: unknown): value is PlaylistSelectPhase => objectWithString(value, "requestId") &&
  typeof value.actionId === "string" && typeof value.videoId === "string" && typeof value.playlistId === "string" &&
  ["commit", "playing", "success", "error"].includes(String(value.phase)) && optionalStringField(value, "source") &&
  optionalStringField(value, "quality") && optionalStringField(value, "layer") && optionalStringField(value, "error");

function operation<Output>(
  name: string,
  legacyRequestEvent: string,
  legacyResponseEvent: string,
  timeoutMs: number,
  validate: (value: unknown) => value is Output,
  matchesLegacyResponse: (input: unknown, output: unknown) => boolean,
  legacyResponseDisposition: (value: Output) => LegacyResponseDisposition = () => "final",
): PreviewPageOperationConfig<Output> {
  return {
    requestEvent: `skip-ads-preview-page-${name}-request`,
    responseEvent: `skip-ads-preview-page-${name}-response`,
    legacyRequestEvent,
    legacyResponseEvent,
    timeoutMs,
    validate,
    matchesLegacyResponse,
    legacyResponseDisposition,
  };
}

export const previewPageOperations: { [K in keyof PreviewPageOperations]: PreviewPageOperationConfig<PreviewPageOperations[K]["output"]> } = {
  quality: operation("quality", qualityRequestEvent, qualityResponseEvent, 3000, qualityState, matchesLegacyFields("source")),
  captions: operation("captions", captionRequestEvent, captionResponseEvent, 3000, captionState, matchesLegacyFields("source")),
  metadata: operation("metadata", metadataRequestEvent, metadataResponseEvent, 20_000, metadataState, matchesLegacyFields("source")),
  info: operation("info", infoRequestEvent, infoResponseEvent, 20_000, infoState, matchesLegacyFields("source", "requestId")),
  // A prepared response may remain ready for 30 seconds before its terminal
  // idle event, in addition to the time YouTube needs to prepare it.
  "playlist-prime": operation("playlist-prime", playlistPrefetchEvent, playlistPreviewWarmPhaseEvent, 60_000, primePhase,
    matchesLegacyFields("videoId", "actionId"), value => value.phase === "preparing" || value.phase === "ready" ? "progress" : "final"),
  "playlist-load": operation("playlist-load", playlistRequestEvent, playlistResponseEvent, 20_000, playlist,
    matchesLegacyFields("source", "videoId", "playlistId"), value => "provisional" in value && value.provisional === true ? "ignore" : "final"),
  // Independent stage-local recovery remains below this safety ceiling even
  // when startup, renderer wake, and response each consume one retry.
  "playlist-select": operation("playlist-select", playlistSelectEvent, playlistSelectPhaseEvent, 30_000, selectPhase,
    matchesLegacyFields("requestId", "actionId", "videoId", "playlistId"),
    value => ["success", "error"].includes(value.phase) ? "final" : "progress"),
};
