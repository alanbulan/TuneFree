import { AudioQuality, PlayMode, Song } from "../types";

const PLAYER_STORAGE_KEYS = {
  queue: "tunefree_queue",
  currentSong: "tunefree_current_song",
  playMode: "tunefree_play_mode",
  quality: "tunefree_quality",
} as const;

export const getPlayerStorage = <T,>(key: string, fallback: T): T => {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : fallback;
  } catch {
    return fallback;
  }
};

export const loadStoredQueue = (): Song[] =>
  getPlayerStorage(PLAYER_STORAGE_KEYS.queue, [] as Song[]);

export const loadStoredCurrentSong = (): Song | null =>
  getPlayerStorage(PLAYER_STORAGE_KEYS.currentSong, null as Song | null);

export const loadStoredPlayMode = (): PlayMode =>
  getPlayerStorage(PLAYER_STORAGE_KEYS.playMode, "sequence" as PlayMode);

export const loadStoredAudioQuality = (): AudioQuality =>
  getPlayerStorage(PLAYER_STORAGE_KEYS.quality, "320k" as AudioQuality);

export const persistQueue = (queue: Song[]): void => {
  localStorage.setItem(PLAYER_STORAGE_KEYS.queue, JSON.stringify(queue));
};

export const persistCurrentSong = (song: Song | null): void => {
  localStorage.setItem(PLAYER_STORAGE_KEYS.currentSong, JSON.stringify(song));
};

export const persistPlayMode = (mode: PlayMode): void => {
  localStorage.setItem(PLAYER_STORAGE_KEYS.playMode, JSON.stringify(mode));
};

export const persistAudioQuality = (quality: AudioQuality): void => {
  localStorage.setItem(PLAYER_STORAGE_KEYS.quality, JSON.stringify(quality));
};
