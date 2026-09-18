export type PlaylistPlaybackPlayer = Readonly<{
  isMuted?: () => boolean;
  mute?: () => void;
  unMute?: () => void;
  getVolume?: () => number;
  setVolume?: (volume: number) => void;
  getPlaybackRate?: () => number;
  setPlaybackRate?: (rate: number) => void;
  playVideo?: () => void;
}>;

export type PlaylistPlaybackMedia = EventTarget & {
  muted: boolean;
  volume: number;
  playbackRate: number;
};

export type PlaylistPlaybackAudioState = Readonly<{
  playerMuted: boolean;
  playerVolume: number | undefined;
  nativeMuted: boolean;
  nativeVolume: number;
}>;

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

type PlaylistPlaybackRestorerOptions = Readonly<{
  isCurrent(): boolean;
  audioUnchanged(): boolean;
  schedule?: (callback: () => void, milliseconds: number) => unknown;
}>;

/** Owns state restoration that can outlive a playlist player-response commit. */
export function createPlaylistPlaybackRestorer(
  player: PlaylistPlaybackPlayer,
  media: PlaylistPlaybackMedia,
  options: PlaylistPlaybackRestorerOptions,
) {
  const schedule = options.schedule ?? ((callback: () => void, milliseconds: number) => setTimeout(callback, milliseconds));
  let state: Readonly<{ audio: PlaylistPlaybackAudioState; rate: number }> | undefined;

  const restoreAudio = () => {
    if (!options.isCurrent() || !state) return undefined;
    if (typeof state.audio.playerVolume === "number") player.setVolume?.(state.audio.playerVolume);
    if (state.audio.playerMuted) player.mute?.(); else player.unMute?.();
    media.volume = state.audio.nativeVolume;
    media.muted = state.audio.nativeMuted;
    return state;
  };
  const restore = () => {
    const snapshot = restoreAudio();
    if (!snapshot) return false;
    player.setPlaybackRate?.(snapshot.rate);
    media.playbackRate = snapshot.rate;
    player.playVideo?.();
    return true;
  };

  let listening = false;

  return {
    restore,
    listen() {
      if (listening || !options.isCurrent()) return false;
      state = {
        audio: playlistPlaybackAudioState(player.isMuted?.(), player.getVolume?.(), media.muted, media.volume),
        rate: player.getPlaybackRate?.() ?? media.playbackRate,
      };
      listening = true;
      for (const name of ["loadedmetadata", "loadeddata", "canplay"])
        media.addEventListener(name, restore, { once: true });
      return true;
    },
    retainAudio() {
      for (const milliseconds of [100, 250, 500, 800]) schedule(() => {
        if (options.audioUnchanged()) restoreAudio();
      }, milliseconds);
    },
  };
}
