import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../../core/ipc';
import { deferred } from '../../../core/__tests__/deferred';
import { DownloadProvider, useSongDownload } from '../useSongDownload';
const mocks = vi.hoisted(() => ({ tauri: true, invoke: vi.fn(), url: vi.fn(), toast: vi.fn(), listen: vi.fn(), dispose: vi.fn(), progress: null as null | ((p: unknown) => void) }));
vi.mock('../../../core/ipc', async (original) => ({ ...await original<typeof import('../../../core/ipc')>(), isTauri: () => mocks.tauri, invokeCommand: mocks.invoke, listenEvent: mocks.listen }));
vi.mock('../../../core/services/api', async (original) => ({ ...await original<typeof import('../../../core/services/api')>(), getSongUrl: mocks.url }));
vi.mock('../../../core/services/offlineDownloads', () => ({ notifyOfflineChanged: vi.fn() }));
vi.mock('../../../core/services/recommendation', () => ({ logRecommendationEvent: vi.fn().mockRejectedValue(new Error('feedback')) }));
vi.mock('../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
const song = { id: '1', source: 'qq', name: '歌曲', artist: '歌手', album: '' };
const ready = async () => { await act(async () => {}); };
beforeEach(() => {
  vi.clearAllMocks(); mocks.tauri = true; mocks.progress = null; mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.url.mockReset().mockResolvedValue('https://example.test/song.mp3');
  mocks.listen.mockReset().mockImplementation(async (_event, fn) => { mocks.progress = fn; return mocks.dispose; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('下载取消和失败边界', () => {
  it('解析期取消使晚到 URL 失效，并阻止重复下载和重复取消', async () => {
    const pending = deferred<string>(); mocks.url.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(useSongDownload, { wrapper: DownloadProvider }); let task!: Promise<void>;
    await act(async () => result.current.cancelDownload());
    act(() => { task = result.current.handleDownload(song, 'flac'); });
    await act(async () => result.current.handleDownload(song, '320k')); expect(mocks.url).toHaveBeenCalledTimes(1);
    vi.spyOn(console, 'error').mockImplementation(() => {}); mocks.invoke.mockRejectedValueOnce(new Error('取消指令失败'));
    await act(async () => { await result.current.cancelDownload(); await result.current.cancelDownload(); }); expect(mocks.invoke).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve('https://late.test/a.mp3'); await task; });
    expect(mocks.invoke.mock.calls.map((c) => c[0])).toEqual(['cancel_download']); expect(result.current.isDownloading).toBe(false); expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('只接受当前任务的进度，取消错误静默，空 URL 可见', async () => {
    const pending = deferred<void>(); mocks.invoke.mockReturnValueOnce(pending.promise);
    const view = renderHook(useSongDownload, { wrapper: DownloadProvider }); let task!: Promise<void>;
    act(() => { task = view.result.current.handleDownload(song, '320k'); }); await ready();
    const taskId = mocks.invoke.mock.calls[0][1].taskId;
    act(() => mocks.progress?.({ taskId: 'other', progress: 80 })); expect(view.result.current.downloadProgress).toBe(0);
    act(() => mocks.progress?.({ taskId, progress: 60 })); expect(view.result.current.downloadProgress).toBe(60);
    await act(async () => { pending.reject(new IpcError('CANCELLED', '取消')); await task; }); expect(mocks.toast).not.toHaveBeenCalled();
    mocks.url.mockResolvedValueOnce(''); await act(async () => view.result.current.handleDownload(song, '320k')); expect(mocks.toast).toHaveBeenLastCalledWith('无法获取下载地址', 'error');
    view.unmount(); expect(mocks.dispose).toHaveBeenCalledTimes(1); act(() => mocks.progress?.({ taskId, progress: 100 }));
  });
  it('目录失败提供重新选择，选择成功缓存路径，选择取消或失败不会自动重下', async () => {
    mocks.invoke.mockRejectedValueOnce(new IpcError('DOWNLOAD_DIR_INVALID', '失效'));
    const { result } = renderHook(useSongDownload, { wrapper: DownloadProvider }); await act(async () => result.current.handleDownload(song, '320k'));
    const pick = mocks.toast.mock.lastCall![2].onClick;
    mocks.invoke.mockResolvedValueOnce(null); await act(async () => pick());
    mocks.invoke.mockResolvedValueOnce('D:/Music'); await act(async () => pick()); expect(mocks.toast).toHaveBeenLastCalledWith('下载目录已更新，请重新下载', 'success');
    mocks.invoke.mockRejectedValueOnce(new Error('不能选择')); await act(async () => pick()); expect(mocks.toast.mock.lastCall![1]).toBe('error'); expect(mocks.url).toHaveBeenCalledTimes(1);
  });
  it('浏览器下载与取消、订阅失败及迟到清理各有明确行为', async () => {
    mocks.tauri = false; vi.stubGlobal('crypto', { randomUUID: undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const view = renderHook(useSongDownload, { wrapper: DownloadProvider }); await act(async () => view.result.current.handleDownload(song, '128k'));
    expect(mocks.toast).toHaveBeenLastCalledWith('已开始下载', 'success'); expect(click).toHaveBeenCalled();
    const pending = deferred<string>(); mocks.url.mockReturnValueOnce(pending.promise); let task!: Promise<void>;
    act(() => { task = view.result.current.handleDownload(song, 'flac'); }); await act(async () => view.result.current.cancelDownload());
    await act(async () => { pending.resolve('late'); await task; }); expect(mocks.invoke).not.toHaveBeenCalled(); view.unmount();
    mocks.tauri = true; const subscribe = deferred<() => void>(); mocks.listen.mockReturnValueOnce(subscribe.promise);
    const next = renderHook(useSongDownload, { wrapper: DownloadProvider }); next.unmount(); await act(async () => subscribe.resolve(mocks.dispose)); expect(mocks.dispose).toHaveBeenCalled();
    vi.spyOn(console, 'warn').mockImplementation(() => {}); mocks.listen.mockRejectedValueOnce(new Error('订阅失败'));
    renderHook(useSongDownload, { wrapper: DownloadProvider }); await ready(); expect(console.warn).toHaveBeenCalled();
  });
});
