// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types';
import {
  PLAYER_STORAGE_KEYS,
  loadStoredAudioQuality,
  loadStoredCurrentSong,
  loadStoredPlayMode,
  loadStoredQueue,
  persistAudioQuality,
  persistCurrentSong,
  persistPlayMode,
  persistQueue,
  stripRuntimeSongFields,
} from '../playerPersistence';

const resolvedSong = {
  id: '1',
  source: 'netease',
  name: 'Song',
  artist: 'Artist',
  album: 'Album',
  pic: 'https://example.com/cover.jpg',
  url: 'http://127.0.0.1:51234/api/cors-proxy?token=abc&url=x',
  urlId: 'url-1',
  lrc: '[00:01.00]很长的歌词'.repeat(500),
  lyricBundle: { main: 'main', translation: 'translation' },
} as Song;

describe('player persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('strips runtime-only fields before writing a song', () => {
    const stripped = stripRuntimeSongFields(resolvedSong);
    expect(stripped).not.toHaveProperty('url');
    expect(stripped).not.toHaveProperty('urlId');
    expect(stripped).not.toHaveProperty('lrc');
    expect(stripped).not.toHaveProperty('lyricBundle');
    expect(stripped).toMatchObject({ id: '1', source: 'netease', pic: resolvedSong.pic });
  });

  it('never persists a resolved proxy url or lyric text in the queue', () => {
    persistQueue([resolvedSong]);
    const raw = localStorage.getItem(PLAYER_STORAGE_KEYS.queue) || '';
    expect(raw).not.toContain('cors-proxy');
    expect(raw).not.toContain('很长的歌词');
    expect(loadStoredQueue()).toEqual([expect.objectContaining({ id: '1', source: 'netease' })]);
  });

  it('persists the current song without runtime fields and clears it on null', () => {
    persistCurrentSong(resolvedSong);
    expect(loadStoredCurrentSong()).toMatchObject({ id: '1', source: 'netease' });
    expect(loadStoredCurrentSong()).not.toHaveProperty('url');
    persistCurrentSong(null);
    expect(localStorage.getItem(PLAYER_STORAGE_KEYS.currentSong)).toBeNull();
    expect(loadStoredCurrentSong()).toBeNull();
  });

  it('swallows quota errors instead of letting them unmount the tree', () => {
    const setItem = vi.fn(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    vi.stubGlobal('localStorage', {
      length: 0, key: () => null, getItem: () => null,
      removeItem: () => {}, clear: () => {}, setItem,
    });
    try {
      expect(() => persistQueue([resolvedSong])).not.toThrow();
      expect(() => persistCurrentSong(resolvedSong)).not.toThrow();
      expect(() => persistPlayMode('shuffle')).not.toThrow();
      expect(() => persistAudioQuality('flac')).not.toThrow();
      expect(setItem).toHaveBeenCalledTimes(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('falls back and backs up when the stored queue is not an array', () => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.queue, '{"queue":"broken"}');
    expect(loadStoredQueue()).toEqual([]);
    expect(localStorage.getItem(PLAYER_STORAGE_KEYS.queue)).toBeNull();
    const backupKeys = Object.keys(localStorage)
      .filter((key) => key.startsWith(`${PLAYER_STORAGE_KEYS.queue}_corrupt_`));
    expect(backupKeys).toHaveLength(1);
  });

  it('drops queue entries that are missing an identity', () => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.queue, JSON.stringify([
      { id: '1', source: 'netease', name: 'ok' },
      { name: 'no identity' },
      { id: '2' },
    ]));
    expect(loadStoredQueue()).toEqual([expect.objectContaining({ id: '1', source: 'netease' })]);
  });

  it('survives malformed json without throwing', () => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.queue, '{not json');
    localStorage.setItem(PLAYER_STORAGE_KEYS.currentSong, '{not json');
    expect(loadStoredQueue()).toEqual([]);
    expect(loadStoredCurrentSong()).toBeNull();
  });

  it('treats the legacy "null" current song as empty rather than corrupt', () => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.currentSong, 'null');
    expect(loadStoredCurrentSong()).toBeNull();
    const backupKeys = Object.keys(localStorage)
      .filter((key) => key.startsWith(`${PLAYER_STORAGE_KEYS.currentSong}_corrupt_`));
    expect(backupKeys).toHaveLength(0);
  });

  it('rejects out-of-domain play modes and qualities', () => {
    localStorage.setItem(PLAYER_STORAGE_KEYS.playMode, '"random"');
    localStorage.setItem(PLAYER_STORAGE_KEYS.quality, '"1024k"');
    expect(loadStoredPlayMode()).toBe('sequence');
    expect(loadStoredAudioQuality()).toBe('320k');
  });

  it('round-trips valid play mode and quality values', () => {
    persistPlayMode('shuffle');
    persistAudioQuality('flac24bit');
    expect(loadStoredPlayMode()).toBe('shuffle');
    expect(loadStoredAudioQuality()).toBe('flac24bit');
  });
});
