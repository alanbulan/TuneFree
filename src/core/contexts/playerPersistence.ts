import { AudioQuality, PlayMode, Song } from "../types";
import {
  getStoredJson,
  normalizeSong,
  normalizeSongArray,
  removeStoredValue,
  setStoredValue,
} from "./libraryData";

export const PLAYER_STORAGE_KEYS = {
  queue: "tunefree_queue",
  currentSong: "tunefree_current_song",
  playMode: "tunefree_play_mode",
  quality: "tunefree_quality",
} as const;

const PLAY_MODES: readonly PlayMode[] = ["sequence", "loop", "shuffle"];
const AUDIO_QUALITIES: readonly AudioQuality[] = ["128k", "320k", "flac", "flac24bit"];

const DEFAULT_PLAY_MODE: PlayMode = "sequence";
const DEFAULT_AUDIO_QUALITY: AudioQuality = "320k";

import { stripRuntimeSongFields } from '../services/songStorage';
export { stripRuntimeSongFields } from '../services/songStorage';

const normalizePlayMode = (value: unknown): PlayMode | null =>
  PLAY_MODES.includes(value as PlayMode) ? (value as PlayMode) : null;

const normalizeAudioQuality = (value: unknown): AudioQuality | null =>
  AUDIO_QUALITIES.includes(value as AudioQuality) ? (value as AudioQuality) : null;

const readRawItem = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn(`读取本地数据失败: ${key}`, error);
    return null;
  }
};

const persistJson = (key: string, value: unknown): void => {
  let payload = "";
  try {
    payload = JSON.stringify(value);
  } catch (error) {
    console.warn(`序列化本地数据失败: ${key}`, error);
    return;
  }
  setStoredValue(key, payload);
};

export const loadStoredQueue = (): Song[] =>
  getStoredJson<Song[]>(PLAYER_STORAGE_KEYS.queue, [], normalizeSongArray);

export const loadStoredCurrentSong = (): Song | null => {
  const raw = readRawItem(PLAYER_STORAGE_KEYS.currentSong);
  // "null" 是旧版本写入的合法值，不能当成损坏数据去备份。
  if (!raw || raw === "null") return null;
  return getStoredJson<Song | null>(PLAYER_STORAGE_KEYS.currentSong, null, normalizeSong);
};

export const loadStoredPlayMode = (): PlayMode =>
  getStoredJson<PlayMode>(PLAYER_STORAGE_KEYS.playMode, DEFAULT_PLAY_MODE, normalizePlayMode);

export const loadStoredAudioQuality = (): AudioQuality =>
  getStoredJson<AudioQuality>(
    PLAYER_STORAGE_KEYS.quality, DEFAULT_AUDIO_QUALITY, normalizeAudioQuality,
  );

export const persistQueue = (queue: Song[]): void => {
  persistJson(PLAYER_STORAGE_KEYS.queue, queue.map(stripRuntimeSongFields));
};

export const persistCurrentSong = (song: Song | null): void => {
  if (!song) {
    removeStoredValue(PLAYER_STORAGE_KEYS.currentSong);
    return;
  }
  persistJson(PLAYER_STORAGE_KEYS.currentSong, stripRuntimeSongFields(song));
};

export const persistPlayMode = (mode: PlayMode): void => {
  persistJson(PLAYER_STORAGE_KEYS.playMode, normalizePlayMode(mode) || DEFAULT_PLAY_MODE);
};

export const persistAudioQuality = (quality: AudioQuality): void => {
  persistJson(
    PLAYER_STORAGE_KEYS.quality, normalizeAudioQuality(quality) || DEFAULT_AUDIO_QUALITY,
  );
};
