// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStore } from '../useLibraryStore';
import { FAVORITES_KEY, PLAYLISTS_KEY, type LibraryImportPreview } from '../libraryData';
import { LIBRARY_KEY } from '../libraryStorage';
import { logRecommendationEvent } from '../../services/recommendation';

vi.mock('../../services/recommendation', () => ({ logRecommendationEvent: vi.fn().mockResolvedValue(undefined) }));
const song = { id: 1, source: 'netease', name: '歌曲', artist: '歌手', album: '' };

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('曲库原子保存', () => {
  it('歌单和虚拟收藏支持添加、去重、移除及兼容导入', () => {
    const { result } = renderHook(useLibraryStore);
    act(() => { result.current.actionsValue.createPlaylist('夜晚'); });
    const id = result.current.dataValue.playlists[1].id;
    act(() => {
      expect(result.current.actionsValue.addToPlaylist(id, song)).toBe(true);
      expect(result.current.actionsValue.addToPlaylist(id, song)).toBe(true);
      expect(result.current.actionsValue.addToPlaylist('favorites', song)).toBe(true);
    });
    expect(result.current.dataValue.playlists[1].songs).toEqual([song]);
    expect(result.current.dataValue.favorites).toEqual([song]);
    expect(logRecommendationEvent).toHaveBeenCalledTimes(2);
    act(() => { expect(result.current.actionsValue.removeFromPlaylist('favorites', song.id, song.source)).toBe(true); });
    expect(result.current.dataValue.favorites).toEqual([]);
    const before = localStorage.getItem(LIBRARY_KEY);
    act(() => {
      expect(result.current.actionsValue.applyImportData({ favorites: null, playlists: [] } as unknown as LibraryImportPreview).ok).toBe(false);
      expect(result.current.actionsValue.importData('{}')).toBe(false);
    });
    expect(localStorage.getItem(LIBRARY_KEY)).toBe(before);
    act(() => { expect(result.current.actionsValue.importData(JSON.stringify({ favorites: [song] }))).toBe(true); });
    expect(result.current.dataValue.favorites).toEqual([song]);
    expect(result.current.dataValue.playlists).toHaveLength(1);
  });

  it('读取旧曲库，连续操作不丢失数据，成功后迁移为单份快照', () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([song]));
    localStorage.setItem(PLAYLISTS_KEY, '[]');
    const { result } = renderHook(useLibraryStore);
    act(() => {
      expect(result.current.actionsValue.createPlaylist('一', [song])).toBe(true);
      expect(result.current.actionsValue.createPlaylist('二')).toBe(true);
    });
    const saved = JSON.parse(localStorage.getItem(LIBRARY_KEY)!);
    expect(saved.favorites).toHaveLength(1);
    expect(saved.playlists).toHaveLength(2);
    expect(saved.playlists[0].id).not.toBe(saved.playlists[1].id);
    expect(localStorage.getItem(FAVORITES_KEY)).toBeNull();
  });

  it('配额不足时收藏和导入均失败，界面及持久数据都保持原样', () => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([song]));
    const original = localStorage;
    vi.stubGlobal('localStorage', {
      getItem: original.getItem.bind(original), removeItem: original.removeItem.bind(original),
      setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(useLibraryStore);
    act(() => {
      expect(result.current.actionsValue.toggleFavorite(song)).toBe(false);
      const parsed = result.current.actionsValue.parseImportData('{"favorites":[],"playlists":[]}');
      if (!parsed.ok) throw new Error(parsed.error);
      expect(result.current.actionsValue.applyImportData(parsed.data).ok).toBe(false);
    });
    expect(result.current.dataValue.favorites).toEqual([song]);
    expect(original.getItem(FAVORITES_KEY)).toBe(JSON.stringify([song]));
    expect(original.getItem(LIBRARY_KEY)).toBeNull();
    expect(logRecommendationEvent).not.toHaveBeenCalled();
    expect(result.current.dataValue.saveError).toBeTruthy();
  });

  it('导入及撤销都落盘，并剔除大段歌词', () => {
    const { result } = renderHook(useLibraryStore);
    act(() => {
      const parsed = result.current.actionsValue.parseImportData(JSON.stringify({ favorites: [{ ...song, lrc: '歌词' }] }));
      if (!parsed.ok) throw new Error(parsed.error);
      const imported = result.current.actionsValue.applyImportData(parsed.data);
      expect(imported.ok).toBe(true);
      expect(localStorage.getItem(LIBRARY_KEY)).not.toContain('歌词');
      if (imported.ok) expect(result.current.actionsValue.restoreData(imported.backup)).toBe(true);
    });
    expect(JSON.parse(localStorage.getItem(LIBRARY_KEY)!).favorites).toEqual([]);
  });
});
