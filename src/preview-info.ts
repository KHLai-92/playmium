import { nativeText } from './preview-metadata';

export const infoRequestEvent = 'skip-ads-preview-info-request';
export const infoResponseEvent = 'skip-ads-preview-info-response';
export type RichRun = { text: string; url?: string; seek?: number };
export type Description = { title: string; author: string; authorUrl?: string; avatar?: string; views: string; published: string; runs: RichRun[] };
export type Comment = { id: string; author: string; authorUrl?: string; avatar?: string; text: string; published: string; likes: string; creator: boolean; verified: boolean; pinned: string; replies?: string; inlineReplies: Comment[]; replyLabel: string };
export type CommentsPage = { items: Comment[]; next?: string; sorts: { label: string; token: string; selected: boolean }[]; count: string; message: string };
export type InfoResponse = { requestId: number; videoId: string; source: string; error: string; description?: Description; comments?: CommentsPage };

export function findNative(data: unknown, key: string): any[] {
  const result: any[] = [], stack: any[] = [data]; let visited = 0;
  while (stack.length && visited++ < 100000) {
    const value = stack.pop(); if (!value || typeof value !== 'object') continue;
    if (value[key]) result.push(value[key]);
    stack.push(...Object.values(value).reverse());
  }
  return result;
}
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try { const url = new URL(value, 'https://www.youtube.com'); return ['https:', 'http:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; }
}
export function safeImage(value: unknown): string | undefined {
  const url = safeUrl(value);
  return url && /^https:\/\/([\w-]+\.)?(ytimg\.com|ggpht\.com)\//.test(url) ? url : undefined;
}
const endpointUrl = (endpoint: any) => safeUrl(endpoint?.commandMetadata?.webCommandMetadata?.url ?? endpoint?.urlEndpoint?.url);
export function descriptionFrom(data: any, player: any, videoId: string): Description {
  const secondary = findNative(data, 'videoSecondaryInfoRenderer')[0];
  const header = findNative(data, 'videoDescriptionHeaderRenderer')[0];
  const owner = secondary?.owner?.videoOwnerRenderer;
  const body = secondary?.attributedDescription ?? secondary?.description ?? findNative(data, 'expandableVideoDescriptionBodyRenderer')[0]?.attributedDescription;
  const text = nativeText(body) || player?.videoDetails?.shortDescription || '';
  const runs: RichRun[] = [];
  if (Array.isArray(body?.commandRuns)) {
    let end = 0;
    for (const run of [...body.commandRuns].sort((a: any, b: any) => a.startIndex - b.startIndex)) {
      const start = run.startIndex, length = run.length;
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < end || length < 1 || start + length > text.length) continue;
      if (start > end) runs.push({ text: text.slice(end, start) });
      const command = run.onTap?.innertubeCommand;
      const watch = command?.watchEndpoint;
      runs.push({ text: text.slice(start, start + length), ...(watch?.videoId === videoId && Number.isFinite(watch.startTimeSeconds) ? { seek: watch.startTimeSeconds } : { url: endpointUrl(command) }) });
      end = start + length;
    }
    if (end < text.length) runs.push({ text: text.slice(end) });
  } else if (Array.isArray(body?.runs)) for (const run of body.runs) runs.push({ text: run.text ?? '', url: endpointUrl(run.navigationEndpoint) });
  else runs.push({ text });
  return { title: nativeText(header?.title) || player?.videoDetails?.title || '', author: nativeText(header?.channel ?? owner?.title) || player?.videoDetails?.author || '',
    authorUrl: endpointUrl(header?.channelNavigationEndpoint ?? owner?.navigationEndpoint), avatar: safeImage((header?.channelThumbnail?.thumbnails ?? owner?.thumbnail?.thumbnails)?.at(-1)?.url),
    views: nativeText(header?.views) || String(player?.videoDetails?.viewCount ?? ''), published: nativeText(header?.publishDate) || player?.microformat?.playerMicroformatRenderer?.publishDate || '', runs };
}
export function continuationFrom(data: unknown): string | undefined {
  const token = findNative(data, 'continuationCommand')[0]?.token;
  return typeof token === 'string' && token.length < 20000 ? token : undefined;
}
export function commentsSeed(data: unknown): string | undefined {
  const sections = findNative(data, 'itemSectionRenderer');
  return continuationFrom(sections.find(s => s.targetId === 'comments-section') ?? sections.find(s => s.sectionIdentifier === 'comment-item-section'));
}
export function commentsFrom(data: any): CommentsPage {
  const entities = new Map(findNative(data, 'commentEntityPayload').map(e => [e.key, e]));
  const actions = [...(data?.onResponseReceivedEndpoints ?? []), ...(data?.onResponseReceivedActions ?? [])];
  const rows = actions.flatMap((a: any) => (a.reloadContinuationItemsCommand ?? a.appendContinuationItemsAction)?.continuationItems ?? []);
  function parseComment(row: any, depth = 0): Comment | undefined {
    if (depth > 8) return;
    const thread = row.commentThreadRenderer ?? row;
    const model = thread.commentViewModel?.commentViewModel ?? thread.commentViewModel;
    const entity = entities.get(model?.commentKey);
    const legacy = thread.comment?.commentRenderer ?? thread.commentRenderer;
    if (!entity && !legacy) return;
    const author = entity?.author;
    const replies = thread.replies?.commentRepliesRenderer;
    const children = replies?.subThreads ?? replies?.contents ?? [];
    return { id: entity?.properties?.commentId ?? legacy.commentId,
      author: author?.displayName ?? nativeText(legacy?.authorText), authorUrl: endpointUrl(author?.channelCommand?.innertubeCommand ?? legacy?.authorEndpoint),
      avatar: safeImage(author?.avatarThumbnailUrl ?? legacy?.authorThumbnail?.thumbnails?.at(-1)?.url),
      text: nativeText(entity?.properties?.content ?? legacy?.contentText), published: entity?.properties?.publishedTime ?? nativeText(legacy?.publishedTimeText),
      likes: entity?.toolbar?.likeCountNotliked ?? nativeText(legacy?.voteCount), creator: Boolean(author?.isCreator ?? legacy?.authorIsChannelOwner), verified: Boolean(author?.isVerified),
      pinned: nativeText(legacy?.pinnedCommentBadge?.pinnedCommentBadgeRenderer?.label),
      replies: continuationFrom(children.find((r: any) => r.continuationItemRenderer)) ?? continuationFrom(replies?.viewReplies),
      inlineReplies: children.map((r: any) => parseComment(r, depth + 1)).filter(Boolean),
      replyLabel: nativeText(replies?.viewReplies?.buttonRenderer?.text) || (entity?.toolbar?.replyCount ? `${entity.toolbar.replyCount} replies` : 'View replies') };
  }
  const items = rows.map((r: any) => parseComment(r)).filter(Boolean) as Comment[];
  const next = continuationFrom(rows.find((r: any) => r.continuationItemRenderer));
  const header = findNative(data, 'commentsHeaderRenderer')[0];
  const sorts = (header?.sortMenu?.sortFilterSubMenuRenderer?.subMenuItems ?? []).map((s: any) => ({ label: s.title, token: continuationFrom(s.serviceEndpoint), selected: Boolean(s.selected) })).filter((s: any) => typeof s.token === 'string');
  return { items, next, sorts, count: nativeText(header?.countText), message: items.length || next ? '' : nativeText(findNative(data, 'messageRenderer')[0]?.text) || 'No comments to show.' };
}
