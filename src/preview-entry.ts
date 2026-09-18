/** Desktop document scope. Content inside Shorts keeps YouTube's native behavior. */
export function previewPageSupported(pathname: string) {
  return !/^\/shorts(?:\/|$)/.test(pathname);
}

export const previewNativeHostSelector = "ytd-video-preview, #inline-preview-player, #video-preview";
export const previewHostSelector = `${previewNativeHostSelector}, [data-skip-preview-owned]`;
export const previewThumbnailSelector = "ytd-thumbnail, yt-thumbnail-view-model, ytd-playlist-thumbnail, yt-collection-thumbnail-view-model, ytd-playlist-video-renderer a#thumbnail, ytd-playlist-panel-video-renderer a#thumbnail, ytd-notification-renderer .thumbnail-container";
export const previewShortsSelector = "ytd-reel-video-renderer,ytd-reel-item-renderer,ytm-shorts-lockup-view-model,ytm-shorts-lockup-view-model-v2,yt-shorts-lockup-view-model,a[href^='/shorts/'],a[href*='youtube.com/shorts/']";
export const previewCardSelector = "ytd-video-renderer,ytd-radio-renderer,ytd-playlist-renderer,ytd-rich-item-renderer,yt-lockup-view-model,ytd-grid-video-renderer,ytd-compact-video-renderer,ytd-playlist-video-renderer,ytd-playlist-panel-video-renderer,ytd-notification-renderer";

/** YouTube gives owned players the same inner ID as its shared native preview.
 * The outer owner, not that inner player, holds our source identity and lifecycle. */
export function resolvePreviewHost(target: Element): HTMLElement | null {
  return target.closest<HTMLElement>("[data-skip-preview-owned]") ??
    target.closest<HTMLElement>("ytd-video-preview") ?? target.closest<HTMLElement>(previewNativeHostSelector);
}

export type PreviewPlaybackSupport = Readonly<{
  native: boolean;
  reason: "matching-inline-host" | "browse-inline-renderer" | "featured-inline-renderer" |
    "animated-thumbnail" | "non-inline-renderer" | "unverified-renderer";
}>;

/** Select by native playback capability, never by decoded-frame readiness.
 * Renderer contexts below were checked in the user's Chrome on 2026-09-16.
 * A global preview left over from SPA navigation proves nothing for another ID.
 * Unverified layouts get the existing bounded native wake, not an assumed iframe.
 */
export function previewPlaybackSupport(target: Element, videoId: string, pathname: string): PreviewPlaybackSupport {
  const matchingHost = [...target.ownerDocument.querySelectorAll<HTMLElement>(previewNativeHostSelector)].some(host => {
    if (host.closest("[data-skip-preview-owned]")) return false;
    return [...host.querySelectorAll<HTMLAnchorElement>("a[href*='/watch?']")].some(anchor => {
      try { return new URL(anchor.href).searchParams.get("v") === videoId; } catch { return false; }
    });
  });
  const thumbnail = target.closest("ytd-thumbnail,yt-thumbnail-view-model");
  if (thumbnail?.closest("ytd-channel-featured-content-renderer")) return { native: true, reason: "featured-inline-renderer" };
  const card = thumbnail?.closest("ytd-video-renderer,ytd-radio-renderer,yt-lockup-view-model");
  const grid = thumbnail?.closest("ytd-rich-grid-renderer");
  if (card && (pathname === "/" || pathname === "/results" ||
      pathname === "/feed/subscriptions" && grid && !grid.hasAttribute("is-slim-grid") && thumbnail?.closest("ytd-rich-item-renderer"))) {
    return { native: true, reason: "browse-inline-renderer" };
  }
  if (thumbnail?.querySelector("animated-thumbnail-overlay-view-model img[src*='/an_webp/'],ytd-moving-thumbnail-renderer img[src*='/an_webp/']")) {
    return { native: false, reason: "animated-thumbnail" };
  }
  if (target.closest("ytd-notification-renderer,ytd-playlist-video-renderer,ytd-playlist-panel-video-renderer") ||
      card?.matches("yt-lockup-view-model") && (pathname === "/feed/history" || pathname === "/watch" ||
        /\/videos$/.test(pathname) && grid?.hasAttribute("is-slim-grid"))) {
    return { native: false, reason: "non-inline-renderer" };
  }
  // A leased preview keeps its last watch anchor when restored to YouTube.
  // Audited renderer capability above must win over that stale global identity.
  if (matchingHost) return { native: true, reason: "matching-inline-host" };
  return { native: true, reason: "unverified-renderer" };
}

export type PreviewThumbnailEntry = Readonly<{
  videoId: string;
  href: string;
  target: Element;
  surface: "thumbnail" | "notification";
}>;

/** Only a thumbnail surface can authorize activation; never a card's text or avatar. */
export function resolvePreviewThumbnail(target: Element, base: string): PreviewThumbnailEntry | null {
  if (target.closest(previewShortsSelector) || target.closest("button,[role=button],input,select,[role=slider],ytd-miniplayer")) return null;
  let surface = target.closest(previewThumbnailSelector) ?? target.closest(previewNativeHostSelector);
  // A playlist's a#thumbnail is nested inside ytd-thumbnail. Use the physical
  // component consistently for hover, click and state badges, not both owners.
  if (surface?.matches("a#thumbnail")) surface = surface.closest("ytd-thumbnail") ?? surface;
  // One physical surface owns hover/click/state, even when modern thumbnail
  // models are nested inside legacy or collection thumbnail components.
  if (surface?.matches(previewThumbnailSelector)) {
    for (let outer = surface.parentElement?.closest(previewThumbnailSelector); outer;
        outer = surface.parentElement?.closest(previewThumbnailSelector)) surface = outer;
  }
  if (!surface || surface.closest(previewShortsSelector)) return null;
  const card = surface.closest(previewCardSelector);
  const direct = target.closest<HTMLAnchorElement>("a[href]")?.href ?? surface.querySelector<HTMLAnchorElement>("a[href]")?.href;
  // An explicit link owns its identity. Never replace a channel/Shorts/external
  // link with some other watch link found elsewhere in the surrounding card.
  const candidates = direct ? [direct] :
    Array.from(card?.querySelectorAll<HTMLAnchorElement>("a[href*='/watch?'],a[href*='/live/']") ?? []).map(anchor => anchor.href);
  for (const href of candidates) {
    if (!href) continue;
    try {
      const url = new URL(href, base);
      if (url.origin !== new URL(base).origin) continue;
      const videoId = url.pathname === "/watch" ? url.searchParams.get("v") : url.pathname.match(/^\/live\/([\w-]{11})$/)?.[1];
      if (!videoId || !/^[\w-]{11}$/.test(videoId)) continue;
      return { videoId, href: url.href, target: surface, surface: card?.matches("ytd-notification-renderer") ? "notification" : "thumbnail" };
    } catch { /* An invalid or non-video link must retain native navigation. */ }
  }
  return null;
}
