import { safeUrl, safeImage, type InfoResponse, type Comment, type CommentsPage, type RichRun } from './preview-info';
import type { PageBridge } from './preview-page-bridge';
import type { PreviewPageOperations } from './preview-page-operations';
import type { PreviewUiCopy } from './preview-ui-language';

type Owner = { video: HTMLVideoElement; host: HTMLElement; events: AbortController };
export function createInfoViewer(shadow: ShadowRoot, getOwner: () => Owner | null, seek: (time: number) => void,
  pageBridge: PageBridge<PreviewPageOperations, HTMLVideoElement>, initialCopy: PreviewUiCopy) {
  let copy = initialCopy;
  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
    const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
  }
  function button(text: string, action: () => void) { const b = el('button', '', text); b.type = 'button'; b.onclick = action; return b; }
  const root = el('div', 'info-viewer'); root.id = 'info-panel'; root.hidden = true; root.setAttribute('role', 'region'); root.setAttribute('aria-label', copy.videoDescriptionAndComments);
  const header = el('div', 'info-header'); const close = button('×', hide); close.setAttribute('aria-label', copy.closeDescriptionAndComments); const headerTitle = el('strong', '', copy.videoDetails); header.append(headerTitle, close);
  const tabs = el('div', 'info-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', copy.videoDetails);
  const descriptionTab = button(copy.description, () => select('description')), commentsTab = button(copy.comments, () => select('comments'));
  descriptionTab.id = 'info-description-tab'; commentsTab.id = 'info-comments-tab';
  const description = el('div', 'info-body'); description.id = 'info-description';
  const comments = el('div', 'info-body'); comments.id = 'info-comments';
  for (const [tab, panel] of [[descriptionTab, description], [commentsTab, comments]] as const) {
    tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', tab.id);
  }
  tabs.append(descriptionTab, commentsTab); root.append(header, tabs, description, comments); shadow.append(root);
  const style = el('style'); style.textContent = `
    .info-viewer{position:absolute;right:12px;top:12px;bottom:72px;width:410px;max-width:calc(100% - 24px);display:flex;flex-direction:column;min-height:0;background:#181c24fa;color:#f1f3f8;border:1px solid #ffffff28;border-radius:14px;box-shadow:0 12px 40px #0009;z-index:7;pointer-events:auto;font:13px/1.5 system-ui;overflow:hidden}.info-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px}.info-header button{border:0;background:none;font-size:23px;padding:0 5px}.info-tabs{display:flex;gap:4px;padding:0 12px;border-bottom:1px solid #ffffff20}.info-tabs button{flex:1;border:0;border-radius:0;background:none;padding:10px 8px;color:#a8b4c6}.info-tabs button[aria-selected=true]{color:#fff;border-bottom:2px solid #5eead4}.info-body{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:14px;scrollbar-width:thin;scrollbar-color:#64758a transparent}.info-viewer a,.info-link{color:#91caff;text-decoration:none}.info-viewer a:hover{text-decoration:underline}.info-viewer button{font:inherit}.info-link{display:inline!important;border:0!important;padding:0!important;background:none!important;text-align:inherit!important}.info-title{font-size:16px;font-weight:650;margin:0 0 12px}.info-owner{display:flex;align-items:center;gap:10px;margin:10px 0}.info-owner img,.info-avatar{width:34px;height:34px;object-fit:cover;border-radius:50%;flex-shrink:0}.info-meta{font-size:12px;color:#a8b4c6;margin-bottom:12px}.info-description-text,.info-comment-text{white-space:pre-wrap;overflow-wrap:anywhere}.info-collapsed{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}.info-more{border:0!important;background:none!important;color:#9bcfff!important;padding:5px 0!important}.info-sort{display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:12px}.info-sort button{border-radius:18px;padding:5px 10px;font-size:12px;background:#ffffff0c;border:1px solid #ffffff20}.info-sort button[aria-pressed=true]{background:#dce7f3;color:#152233}.info-count{width:100%;font-weight:600;margin-bottom:5px}.info-comment{display:grid;grid-template-columns:34px minmax(0,1fr);gap:9px;padding:12px 0;border-bottom:1px solid #ffffff12}.info-comment-author{display:flex;flex-wrap:wrap;gap:5px;font-size:12px;align-items:baseline}.info-comment-author a:first-child{font-weight:600;color:#eef3f9}.info-comment-author a:last-child{color:#98a8bc;font-size:11px}.info-comment-text{margin:5px 0}.info-comment-foot{display:flex;gap:12px;align-items:center;color:#b6c5d7;font-size:12px}.info-replies{margin-top:8px}.info-replies .info-comment{grid-template-columns:26px minmax(0,1fr)}.info-replies .info-avatar{width:26px;height:26px}.info-badge{color:#7be7d4;font-size:11px}.info-load{margin:12px auto 4px;display:block}.info-status{color:#a8b4c6}.info-viewer[hidden],.info-body[hidden]{display:none!important}
  `; shadow.append(style);
  let owner: Owner | null = null, selected: 'description' | 'comments' = 'description', requestId = 0, generation = 0;
  let descriptionLoaded = false, commentsLoaded = false;
  function current(expected: Owner, version: number) { return owner === expected && getOwner() === expected && generation === version; }
  function localizedError(error: unknown, fallback = copy.couldNotLoadContent) {
    const message = error instanceof Error ? error.message : '';
    const translated: Record<string, string> = {
      'Comments are unavailable for this video.': copy.commentsUnavailableForVideo,
      'That comment page is no longer available.': copy.commentPageUnavailable,
      'Comments could not be loaded.': copy.commentsCouldNotBeLoaded,
      'Video information could not be loaded.': copy.videoInformationCouldNotBeLoaded,
      'Video information was too large.': copy.videoInformationTooLarge,
      'Video information is unavailable.': copy.videoInformationUnavailable,
    };
    return translated[message] ?? (message || fallback);
  }
  function pageMessage(message: string) {
    if (message === 'No comments to show.') return copy.noCommentsToShow;
    if (message === 'Comments are unavailable for this video.') return copy.commentsUnavailableForVideo;
    return message;
  }
  function request(kind: 'description' | 'comments', token?: string): Promise<InfoResponse> {
    const active = getOwner(); if (!active) return Promise.reject(new Error(copy.openPreviewFirst));
    const id = ++requestId;
    return pageBridge.request(active.video, 'info', { source: active.video.currentSrc, requestId: id, kind, token }, { signal: active.events.signal })
      .then((result: InfoResponse) => {
        if (result.error) throw new Error(result.error);
        return result;
      });
  }
  function link(text: string, href?: string) {
    const url = safeUrl(href); if (!url) return el('span', '', text);
    const a = el('a', '', text); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  function rich(parent: HTMLElement, runs: RichRun[]) {
    for (const run of runs) {
      if (Number.isFinite(run.seek)) { const b = button(run.text, () => seek(run.seek!)); b.className = 'info-link'; parent.append(b); }
      else if (run.url) parent.append(link(run.text, run.url));
      else {
        let end = 0;
        for (const match of run.text.matchAll(/https?:\/\/[^\s<>]+|\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/g)) {
          parent.append(document.createTextNode(run.text.slice(end, match.index)));
          if (match[0].startsWith('http')) parent.append(link(match[0], match[0]));
          else { const parts = match[0].split(':').map(Number); const seconds = parts.reduce((total, part) => total * 60 + part, 0); const b = button(match[0], () => seek(seconds)); b.className = 'info-link'; parent.append(b); }
          end = match.index + match[0].length;
        }
        parent.append(document.createTextNode(run.text.slice(end)));
      }
    }
  }
  function expandable(parent: HTMLElement, text: HTMLElement, long: boolean) {
    parent.append(text); if (!long) return;
    text.classList.add('info-collapsed');
    const toggle = button(copy.showMore, () => { const collapsed = text.classList.toggle('info-collapsed'); toggle.textContent = collapsed ? copy.showMore : copy.showLess; });
    toggle.className = 'info-more'; parent.append(toggle);
  }
  function failure(container: HTMLElement, error: unknown, retry: () => void) {
    container.replaceChildren(el('p', 'info-status', localizedError(error)), button(copy.tryAgain, retry));
  }
  async function loadDescription() {
    const expected = owner!, version = generation;
    description.replaceChildren(el('p', 'info-status', copy.loadingDescription));
    try {
      const result = await request('description'); if (!current(expected, version)) return;
      const data = result.description; if (!data || !Array.isArray(data.runs)) throw new Error(copy.descriptionUnavailable);
      description.replaceChildren(el('h2', 'info-title', data.title));
      const channel = el('div', 'info-owner'); const avatar = safeImage(data.avatar);
      if (avatar) { const img = el('img'); img.src = avatar; img.alt = ''; channel.append(img); }
      channel.append(link(data.author, data.authorUrl)); description.append(channel, el('div', 'info-meta', [data.views, data.published].filter(Boolean).join(' · ')));
      const text = el('div', 'info-description-text'); rich(text, data.runs);
      expandable(description, text, data.runs.reduce((n, r) => n + r.text.length, 0) > 400);
      descriptionLoaded = true;
    } catch (error) { if (current(expected, version)) failure(description, error, () => void loadDescription()); }
  }
  function commentNode(comment: Comment, expected: Owner, version: number): HTMLElement {
    const article = el('article', 'info-comment'); article.dataset.commentId = comment.id;
    const avatar = safeImage(comment.avatar); if (avatar) { const img = el('img', 'info-avatar'); img.src = avatar; img.alt = ''; img.loading = 'lazy'; article.append(img); } else article.append(el('span'));
    const content = el('div'); const by = el('div', 'info-comment-author'); by.append(link(comment.author, comment.authorUrl));
    if (comment.creator || comment.verified) by.append(el('span', 'info-badge', comment.creator ? copy.creator : '✓'));
    const videoId = new URL(expected.host.querySelector<HTMLAnchorElement>("a[href*='/watch?']")!.href).searchParams.get('v');
    by.append(link(comment.published, `/watch?v=${videoId}&lc=${encodeURIComponent(comment.id)}`)); content.append(by);
    if (comment.pinned) content.append(el('div', 'info-badge', comment.pinned));
    const text = el('div', 'info-comment-text'); rich(text, [{ text: comment.text }]); expandable(content, text, comment.text.length > 280);
    const foot = el('div', 'info-comment-foot');
    const likes = el('span', '', `👍 ${comment.likes || '0'}`); likes.setAttribute('aria-label', copy.likes(comment.likes || '0')); foot.append(likes); content.append(foot);
    if (comment.replies || comment.inlineReplies.length) {
      const replies = el('div', 'info-replies'); replies.hidden = true; let loaded = false;
      for (const child of comment.inlineReplies) replies.append(commentNode(child, expected, version));
      const replyLabel = () => comment.replyLabel === 'View replies' ? copy.viewReplies : comment.replyLabel;
      const toggle = button(replyLabel(), () => {
        replies.hidden = !replies.hidden; toggle.textContent = replies.hidden ? replyLabel() : copy.hideReplies;
        if (!replies.hidden && !loaded) { loaded = true; if (comment.replies) void loadReplyPage(comment.replies, replies, expected, version, true); }
      }); toggle.className = 'info-more'; content.append(toggle, replies);
    }
    article.append(content); return article;
  }
  async function loadReplyPage(token: string, target: HTMLElement, expected: Owner, version: number, append = false) {
    const status = el('p', 'info-status', copy.loadingReplies); target.append(status);
    try {
      const result = await request('comments', token); if (!current(expected, version)) return;
      status.remove(); const page = result.comments; if (!page) throw new Error(copy.repliesUnavailable);
      if (!append) target.replaceChildren();
      for (const item of page.items) target.append(commentNode(item, expected, version));
      if (!page.items.length) target.append(el('p', 'info-status', pageMessage(page.message)));
      if (page.next) { const more = button(copy.loadMoreReplies, () => { more.remove(); void(loadReplyPage(page.next!, target, expected, version, true)); }); more.className = 'info-more'; target.append(more); }
    } catch (error) { if (current(expected, version)) { status.remove(); target.append(el('p', 'info-status', localizedError(error, copy.repliesCouldNotBeLoaded)), button(copy.tryAgain, () => { target.replaceChildren(); void loadReplyPage(token, target, expected, version); })); } }
  }
  let list = el('div'), sorts = el('div', 'info-sort'), more: HTMLButtonElement | null = null;
  let commentsVersion = 0;
  async function loadComments(token?: string, append = false) {
    const expected = owner!, version = generation, batch = append ? commentsVersion : ++commentsVersion;
    if (!append) { list = el('div'); sorts = el('div', 'info-sort'); comments.replaceChildren(sorts, list); }
    const status = el('p', 'info-status', copy.loadingComments); comments.append(status); more?.remove(); more = null;
    try {
      const result = await request('comments', token); if (!current(expected, version) || batch !== commentsVersion) return;
      status.remove(); const page: CommentsPage | undefined = result.comments; if (!page) throw new Error(copy.commentsUnavailable);
      if (page.sorts.length) {
        sorts.replaceChildren(el('div', 'info-count', page.count || copy.comments));
        for (const sort of page.sorts) { const b = button(sort.label, () => void loadComments(sort.token)); b.setAttribute('aria-pressed', String(sort.selected)); sorts.append(b); }
      }
      const seen = new Set([...list.querySelectorAll<HTMLElement>('[data-comment-id]')].map(c => c.dataset.commentId));
      for (const item of page.items) if (!seen.has(item.id)) { list.append(commentNode(item, expected, version)); seen.add(item.id); }
      if (!page.items.length && !append) list.append(el('p', 'info-status', pageMessage(page.message)));
      if (page.next) { more = button(copy.loadMoreComments, () => void loadComments(page.next, true)); more.className = 'info-load'; comments.append(more); }
      commentsLoaded = true;
    } catch (error) { if (current(expected, version) && batch === commentsVersion) { status.remove(); comments.append(el('p', 'info-status', localizedError(error, copy.commentsCouldNotBeLoaded)), button(copy.tryAgain, () => void loadComments(token, append))); } }
  }
  function select(tab: 'description' | 'comments') {
    selected = tab; description.hidden = tab !== 'description'; comments.hidden = tab !== 'comments';
    for (const [button, name] of [[descriptionTab, 'description'], [commentsTab, 'comments']] as const) { button.setAttribute('aria-selected', String(name === tab)); button.tabIndex = name === tab ? 0 : -1; }
    if (tab === 'description' && !descriptionLoaded) void loadDescription();
    if (tab === 'comments' && !commentsLoaded) void loadComments();
  }
  window.addEventListener('keydown', event => {
    const target = event.composedPath()[0];
    if (root.hidden || ![descriptionTab, commentsTab].includes(target as HTMLButtonElement) || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation(); select(selected === 'description' ? 'comments' : 'description'); (selected === 'description' ? descriptionTab : commentsTab).focus();
  }, true);
  function applyCopy(next: PreviewUiCopy, language: string) {
    const refresh = copy !== next && owner !== null;
    copy = next; root.lang = language;
    root.setAttribute('aria-label', copy.videoDescriptionAndComments);
    close.setAttribute('aria-label', copy.closeDescriptionAndComments);
    headerTitle.textContent = copy.videoDetails;
    tabs.setAttribute('aria-label', copy.videoDetails);
    descriptionTab.textContent = copy.description;
    commentsTab.textContent = copy.comments;
    if (refresh) {
      generation++; descriptionLoaded = false; commentsLoaded = false;
      description.replaceChildren(); comments.replaceChildren();
      if (!root.hidden) select(selected);
    }
  }
  function reset() { generation++; owner = null; descriptionLoaded = false; commentsLoaded = false; description.replaceChildren(); comments.replaceChildren(); root.hidden = true; }
  function sync() { if (owner && owner !== getOwner()) reset(); }
  function hide() { root.hidden = true; }
  function toggle() {
    const active = getOwner(); if (!active) return;
    if (owner !== active) { reset(); owner = active; selected = 'description'; }
    root.hidden = !root.hidden; if (!root.hidden) select(selected);
  }
  return { root, toggle, hide, sync, reset, applyCopy, isOpen: () => !root.hidden };
}
