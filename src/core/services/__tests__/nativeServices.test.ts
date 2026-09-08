import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as offline from '../offlineDownloads';
import * as recommendation from '../recommendation';
import type { Song } from '../../types';
const mocks = vi.hoisted(() => ({ tauri: true, invoke: vi.fn(), convert: vi.fn() }));
vi.mock('../../ipc/env', () => ({ isTauri: () => mocks.tauri }));
vi.mock('../../ipc/commands', () => ({ invokeCommand: mocks.invoke }));
vi.mock('../../ipc/windows', () => ({ convertFileSrc: mocks.convert }));
const song: Song = { id: '1', source: 'qq', name: '歌', artist: '歌手', album: '', url: 'temporary' };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.tauri = true; mocks.invoke.mockReset().mockResolvedValue(undefined); mocks.convert.mockReturnValue('asset://song.mp3'); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('离线媒体与推荐 IPC', () => {
  it('扫描、本地解析和删除都使用后端身份，只有删除成功才通知', async () => {
    const changed = vi.fn(); const unsubscribe = offline.subscribeOfflineDownloads(changed);
    const broken = offline.subscribeOfflineDownloads(() => { throw new Error('observer'); });
    mocks.invoke.mockResolvedValueOnce([{ filename: 'song.mp3' }]); expect(await offline.listOfflineDownloads()).toEqual([{ filename: 'song.mp3' }]);
    mocks.invoke.mockResolvedValueOnce({ filepath: 'D:/Music/song.mp3', song: { lrc: '歌词', pic: '//example.test/a.jpg' }, quality: '320k' });
    expect(await offline.resolveOfflinePlayback(song, '320k')).toEqual({ url: 'asset://song.mp3', lrc: '歌词', pic: 'https://example.test/a.jpg', quality: '320k' });
    expect(mocks.convert).toHaveBeenCalledWith('D:/Music/song.mp3');
    mocks.invoke.mockResolvedValueOnce(null); expect(await offline.resolveOfflinePlayback(song, 'flac')).toBeNull();
    mocks.invoke.mockRejectedValueOnce(new Error('missing')); expect(await offline.resolveOfflinePlayback(song, 'flac')).toBeNull();
    await offline.deleteOfflineDownload('song.mp3'); expect(changed).toHaveBeenCalledTimes(1);
    mocks.invoke.mockRejectedValueOnce(new Error('locked')); await expect(offline.deleteOfflineDownload('song.mp3')).rejects.toThrow('locked'); expect(changed).toHaveBeenCalledTimes(1);
    unsubscribe(); broken(); offline.notifyOfflineChanged(); expect(changed).toHaveBeenCalledTimes(1);
  });
  it('推荐操作传递稳定曲目，配置缓存写入失败不会丢失后端结果', async () => {
    await recommendation.logRecommendationEvent({ eventType: 'play_start', song });
    await recommendation.getRecommendationJob('job'); await recommendation.getLatestRecommendationJob();
    await recommendation.getSimilarSongs(song, { limit: 4 }); await recommendation.dismissRecommendation(song, '不喜欢');
    await recommendation.saveRecommendationFeedback({ requestId: 'job', song, action: 'play', recommendationSource: 'local', context: 'home' });
    await recommendation.rebuildRecommendationIndex(); await recommendation.testLlmProvider();
    mocks.invoke.mockResolvedValueOnce({ databaseSizeBytes: 1, llmCacheEntries: 0 }); expect(await recommendation.clearRecommendationData()).toEqual({ databaseSizeBytes: 1, llmCacheEntries: 0 });
    await recommendation.syncRecommendationLibrary({ favorites: [], playlists: [{ id: 'p', name: '列表', songs: [song] }], queue: [], currentSong: song });
    expect(mocks.invoke).toHaveBeenCalledWith('log_recommendation_event', { event: { eventType: 'play_start', song: expect.not.objectContaining({ url: 'temporary' }) } });
    expect(mocks.invoke).toHaveBeenCalledWith('get_recommendation_job', { jobId: 'job' });
    expect(mocks.invoke).toHaveBeenCalledWith('dismiss_recommendation', { song: expect.not.objectContaining({ url: 'temporary' }), reason: '不喜欢' });
    const storage = localStorage; vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {}); mocks.invoke.mockResolvedValueOnce({ localRecommendationEnabled: true });
    expect(await recommendation.getLlmConfig()).toEqual({ localRecommendationEnabled: true }); expect(console.warn).toHaveBeenCalled();
  });
  it('浏览器与关闭推荐的状态不调用原生服务', async () => {
    mocks.tauri = false;
    expect(await offline.listOfflineDownloads()).toEqual([]); expect(await offline.resolveOfflinePlayback(song, '320k')).toBeNull(); await offline.deleteOfflineDownload('x');
    expect(await recommendation.getRecommendationJob('job')).toBeNull(); expect((await recommendation.getLlmConfig()).enabled).toBe(false);
    expect((await recommendation.testLlmProvider()).status).toBe('browser_preview'); expect(await recommendation.clearRecommendationData()).toEqual({ databaseSizeBytes: 0, llmCacheEntries: 0 });
    await recommendation.dismissRecommendation(song); await recommendation.rebuildRecommendationIndex();
    await recommendation.saveRecommendationFeedback({ requestId: 'job', song, action: 'play', recommendationSource: 'local', context: 'home' });
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.tauri = true; localStorage.setItem('tunefree_local_recommendation_enabled', 'false'); await recommendation.logRecommendationEvent({ eventType: 'play_start' });
    expect(await recommendation.getSimilarSongs(song)).toEqual([]); expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
