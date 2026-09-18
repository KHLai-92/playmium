import { assignedJSON } from './preview-metadata';
import { createPlaylistCatalog } from './preview-playlist-catalog';
import { isPlaylistId } from './preview-playlist';
import { fetchWatchPageSource } from './preview-watch-page-request';

export type WatchPage = { data: any; player: any; context: any };
const pages = createPlaylistCatalog<WatchPage>(async ({ videoId, playlistId }, { signal }) => {
  const response = await fetchWatchPageSource(fetch, `/watch?v=${encodeURIComponent(videoId)}${playlistId ? `&list=${encodeURIComponent(playlistId)}` : ''}`, signal);
  if (!response.ok) throw new Error('Video information could not be loaded.');
  const html = await response.text();
  if (html.length > 12_000_000) throw new Error('Video information was too large.');
  const data = assignedJSON(html, 'var ytInitialData =') ?? assignedJSON(html, 'window["ytInitialData"] =');
  const player = assignedJSON(html, 'var ytInitialPlayerResponse =');
  const config: any = {};
  for (const match of html.matchAll(/ytcfg\.set\(\s*\{/g)) Object.assign(config, assignedJSON(html.slice(match.index), 'ytcfg.set(') ?? {});
  if (!data) throw new Error('Video information is unavailable.');
  return { data, player, context: config.INNERTUBE_CONTEXT };
}, { capacity: 8, debugName: 'watch-page' });
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => pages.dispose(), { once: true });
}
export function loadWatchPage(videoId: string, playlistId = "", options: { signal?: AbortSignal } = {}): Promise<WatchPage> {
  if (!/^[\w-]{11}$/.test(videoId)) return Promise.reject(new Error('Invalid video.'));
  if (playlistId && !isPlaylistId(playlistId)) return Promise.reject(new Error('Invalid playlist.'));
  return pages.load({ videoId, playlistId }, options);
}
