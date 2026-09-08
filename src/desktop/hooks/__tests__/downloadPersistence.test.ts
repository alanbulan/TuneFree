import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), toast: vi.fn(), changed: vi.fn() }));
vi.mock('../../../core/ipc', async (original) => ({
  ...await original<typeof import('../../../core/ipc')>(),
  isTauri: () => true, invokeCommand: mocks.invoke, listenEvent: () => Promise.resolve(() => {}),
}));
vi.mock('../../../core/services/api', () => ({ getSongUrl: () => Promise.resolve('https://example.com/song.mp3') }));
vi.mock('../../../core/services/offlineDownloads', () => ({ notifyOfflineChanged: mocks.changed }));
vi.mock('../../../core/services/recommendation', () => ({ logRecommendationEvent: () => Promise.resolve() }));
vi.mock('../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
import { DownloadProvider, useSongDownload } from '../useSongDownload';
import { IpcError } from '../../../core/ipc';

const song = { id: '1', source: 'qq', name: '歌曲', artist: '歌手', album: '', urlId: 'stable-id', url: 'temporary' };
beforeEach(() => vi.resetAllMocks());
afterEach(cleanup);

describe('下载完成的持久化反馈', () => {
  it('文件与元数据在同一个命令保存，成功后才通知曲库', async () => {
    mocks.invoke.mockResolvedValue({ filepath: 'test/song.mp3', filename: 'song.mp3' });
    const { result } = renderHook(useSongDownload, { wrapper: DownloadProvider });
    await act(() => result.current.handleDownload(song, '320k'));
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(mocks.invoke).toHaveBeenCalledWith('download_song_to_local', expect.objectContaining({
      metadata: { song: expect.objectContaining({ id: '1', urlId: 'stable-id' }), quality: '320k' },
    }));
    expect(mocks.invoke.mock.calls[0][1].metadata.song.url).toBeUndefined();
    expect(mocks.changed).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('下载成功'), 'success');
  });

  it('元数据保存失败时不报成功、不刷新为已下载', async () => {
    const message = '音频已保存为 song.mp3，但下载记录保存失败';
    mocks.invoke.mockRejectedValue(new IpcError('IO', message));
    const { result } = renderHook(useSongDownload, { wrapper: DownloadProvider });
    await act(() => result.current.handleDownload(song, '320k'));
    expect(mocks.toast).toHaveBeenCalledWith(message, 'error', undefined);
    expect(mocks.toast.mock.calls.some((call) => call[1] === 'success')).toBe(false);
    expect(mocks.changed).not.toHaveBeenCalled();
    expect(result.current.isDownloading).toBe(false);
  });
});
