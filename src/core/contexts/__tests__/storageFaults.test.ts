import { afterEach, describe, expect, it, vi } from 'vitest';
import { getStoredJson, getStoredValue, normalizeSongArray, parseLibraryImport, removeStoredValue } from '../libraryData';
import { LIBRARY_KEY, persistLibrary } from '../libraryStorage';
import { loadStoredCurrentSong, persistCurrentSong } from '../playerPersistence';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('存储边界失败', () => {
  it('权限拒绝时读取采用默认值，删除失败不会抛出', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new DOMException('访问被拒绝', 'SecurityError');
    vi.stubGlobal('localStorage', { getItem: () => { throw error; }, removeItem: () => { throw error; } });
    expect(getStoredValue('text', '默认')).toBe('默认');
    expect(getStoredJson('songs', [], normalizeSongArray)).toEqual([]);
    expect(loadStoredCurrentSong()).toBeNull();
    expect(() => removeStoredValue('text')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(4);
  });

  it('损坏数据无法备份时保留原始数据，返回可用的默认值', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('songs', '{}');
    const storage = localStorage;
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage),
      setItem: () => { throw new DOMException('已满', 'QuotaExceededError'); } });
    expect(getStoredJson('songs', [], normalizeSongArray)).toEqual([]);
    expect(storage.getItem('songs')).toBe('{}');
  });

  it('序列化失败不覆盖已有曲库和播放记录', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(LIBRARY_KEY, '旧曲库');
    const song = { id: '1', source: 'qq', name: '歌', artist: '', album: '' };
    const stringify = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => { throw new TypeError('循环引用'); });
    expect(persistLibrary({ favorites: [song], playlists: [] })).toBe(false);
    expect(localStorage.getItem(LIBRARY_KEY)).toBe('旧曲库');
    stringify.mockImplementationOnce(() => { throw new TypeError('循环引用'); });
    expect(() => persistCurrentSong(song)).not.toThrow();
    expect(localStorage.getItem('tunefree_current_song')).toBeNull();
    expect(parseLibraryImport('{"version":4}')).toEqual({ ok: false, error: '导入文件缺少收藏或歌单数据' });
  });
});
