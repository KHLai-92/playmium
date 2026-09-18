import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const compiled = await readFile("dist-preview-prototype/preview-main.js", "utf8");
function scenario({ enabled = true, available = true, toggle = true } = {}) {
  const calls = [];
  const tracks = [{ languageCode: 'zh-TW', vssId: '.zh-TW', displayName: 'Chinese (Traditional)' },
    { languageCode: 'en', vssId: '.en', displayName: 'English' }];
  let selected = tracks[0];
  const translations = [{ languageCode: 'zh-Hant', languageName: 'Chinese (Traditional)' }, { languageCode: 'fr', languageName: 'French' }];
  const listeners = new Map();
  let response;
  class Video extends EventTarget {}
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  const host = { matches: () => true, contains: p => p === player || p === host,
    querySelector: () => enabled ? { textContent: 'Visible native subtitle' } : null };
  const player = { parentElement: host,
    isSubtitlesOn: () => enabled,
    getOption: (module, option) => option === 'translationLanguages' ? translations : option === 'tracklist' ? available ? tracks : [] : enabled ? selected : {},
    toggleSubtitlesOn: () => { calls.push('enable'); enabled = true; },
    setOption: (module, option, value) => { calls.push([module, option, value]); enabled = Boolean(value.languageCode); if (enabled) selected = value; },
    ...(toggle ? { toggleSubtitles: () => { calls.push('toggle'); enabled = !enabled; } } : {}) };
  const video = Object.assign(new Video(), { currentSrc: 'blob:preview', isConnected: true,
    classList: { contains: () => true }, closest: () => host, parentElement: player,
    paused: true, currentTime: 280.34, muted: false, volume: 0.6, playbackRate: 1.5 });
  const window = {}; window.top = window;
  const location = { pathname: '/results' };
  vm.runInNewContext(compiled, { window, location, HTMLVideoElement: Video, CustomEvent,
    document: { addEventListener: (type, cb) => { listeners.set(type, cb); } } });
  video.addEventListener('skip-ads-preview-caption-response', event => { response = JSON.parse(event.detail); });
  const raw = detail => { response = undefined; listeners.get('skip-ads-preview-caption-request')({ target: video, detail }); return response; };
  return { player, video, calls, location, raw, request: (enabled, track, translation) => raw(JSON.stringify({ source: video.currentSrc, enabled, track, translation })) };
}

test('native translation selection and Off preserve the base track and paused media', () => {
  const s = scenario();
  const first = s.request();
  assert.equal(first.translations[0].languageCode, 'zh-Hant');
  const translated = s.request(true, first.tracks[1].id, 'zh-Hant');
  assert.equal(translated.translation, 'zh-Hant');
  assert.equal(translated.selectedTrack, first.tracks[1].id);
  assert.equal(s.calls[0][2].translationLanguage.languageName, 'Chinese (Traditional)');
  assert.equal(s.request(true, undefined, '').translation, '');
  assert.equal(s.request().selectedTrack, first.tracks[1].id);
  assert.equal(s.video.paused, true); assert.equal(s.video.currentTime, 280.34);
});

test('unknown translation cannot inject a native language object', () => {
  const s = scenario();
  assert.match(s.request(undefined, undefined, 'untrusted').error, /unavailable/);
  assert.equal(s.calls.length, 0);
});
test('turn subtitles off and on while preserving paused playback and all media settings', () => {
  const s = scenario();
  const before = [s.video.paused, s.video.currentTime, s.video.muted, s.video.volume, s.video.playbackRate, s.video.currentSrc];
  assert.equal(s.request(false).enabled, false);
  assert.equal(s.request(true).enabled, true);
  assert.deepEqual(s.calls, ['toggle', 'toggle']);
  assert.deepEqual([s.video.paused, s.video.currentTime, s.video.muted, s.video.volume, s.video.playbackRate, s.video.currentSrc], before);
});
test('enabling-only API is never used to disable subtitles', () => {
  const s = scenario({ toggle: false });
  assert.equal(s.request(false).enabled, false);
  assert.equal(JSON.stringify(s.calls[0]), JSON.stringify(['captions', 'track', {}]));
  assert.equal(s.request(true).enabled, true); assert.equal(s.calls[1], 'enable');
});
test('observing captions and reapplying an already satisfied choice do not toggle them', () => {
  const s = scenario(); assert.equal(s.request().enabled, true);
  s.request(true); assert.equal(s.calls.length, 0);
});
test('native language selection enables the chosen track without changing playback', () => {
  const s = scenario({ enabled: false }); const before = s.video.currentTime;
  const state = s.request(); assert.equal(state.tracks.length, 2);
  assert.equal(state.tracks[1].label, 'English');
  const selected = s.request(true, state.tracks[1].id);
  assert.equal(selected.enabled, true); assert.equal(selected.selectedTrack, state.tracks[1].id);
  assert.equal(s.calls[0][0], 'captions'); assert.equal(s.calls[0][1], 'track');
  assert.equal(s.calls[0][2].languageCode, 'en');
  assert.equal(s.video.currentTime, before); assert.equal(s.video.paused, true);
});
test('unknown language IDs cannot inject a track or arbitrary native option', () => {
  const s = scenario(); assert.match(s.request(undefined, 'unknown-language').error, /no longer available/);
  assert.equal(s.calls.length, 0);
});
test('no-caption videos remain unavailable', () => {
  const s = scenario({ enabled: false, available: false });
  assert.equal(s.request(true).available, false); assert.equal(s.calls.length, 0);
});
test('exceptions are reported without breaking preview playback', () => {
  const s = scenario(); s.player.toggleSubtitles = () => { throw Error('native failure'); };
  assert.match(s.request(false).error, /could not update/);
  assert.equal(s.video.paused, true);
});
test('stale, malformed, detached, unpinned and Shorts-page requests cannot toggle captions', () => {
  const s = scenario();
  for (const raw of ['null', 'bad json', 'x'.repeat(2049), JSON.stringify({ source: 'stale', enabled: false }),
    JSON.stringify({ source: s.video.currentSrc, enabled: 'false' })]) assert.equal(s.raw(raw), undefined);
  for (const change of [s => { s.video.isConnected = false; }, s => { s.video.classList.contains = () => false; },
    s => { s.location.pathname = '/shorts/123'; }]) {
    const s = scenario(); change(s); assert.equal(s.request(false), undefined); assert.equal(s.calls.length, 0);
  }
  assert.equal(s.calls.length, 0);
});

test('an authorized pinned preview on the watch page retains captions controls', () => {
  const s = scenario(); s.location.pathname = '/watch';
  assert.equal(s.request(false).error, '');
});
