import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song, Playlist } from '../../../core/types';

const mocks = vi.hoisted(() => ({
  library: { favorites: [] as Song[], playlists: [] as Playlist[] },
  getConfig: vi.fn(), sync: vi.fn(), listen: vi.fn(),
}));
vi.mock('../../../core/contexts/LibraryContext', () => ({ useLibraryData: () => mocks.library }));
vi.mock('../../../core/ipc', async (original) => ({
  ...await original<typeof import('../../../core/ipc')>(), isTauri: () => true, listenEvent: mocks.listen,
}));
vi.mock('../../../core/services/recommendation', () => ({
  getLlmConfig: mocks.getConfig, syncRecommendationLibrary: mocks.sync,
  RECOMMENDATION_CHANGED_EVENT: 'tunefree:recommendation-changed',
}));
import { RecommendationSyncBridge } from '../RecommendationSyncBridge';
import { IpcError } from '../../../core/ipc';

const song: Song = { id: '1', source: 'qq', name: '歌曲', artist: '歌手', album: '' };
let ready: () => void;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.library = { favorites: [song], playlists: [] };
  mocks.getConfig.mockResolvedValue({ localRecommendationEnabled: true });
  mocks.sync.mockResolvedValue(true);
  mocks.listen.mockImplementation((_event, handler) => { ready = handler; return Promise.resolve(vi.fn()); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const changed = () => act(() => { window.dispatchEvent(new Event('tunefree:recommendation-changed')); });

describe('推荐曲库同步', () => {
  it('订阅失败仍读取配置，同步失败后用全量重建基线', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.listen.mockRejectedValueOnce(new Error('事件不可用'));
    mocks.sync.mockRejectedValueOnce(new IpcError('BUSY', '初始化'));
    const view = render(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    await act(async () => {});
    expect(warn).toHaveBeenCalledWith('订阅推荐就绪事件失败', expect.any(Error));
    expect(warn).not.toHaveBeenCalledWith('曲库推荐同步失败', expect.anything());
    mocks.sync.mockRejectedValueOnce(new IpcError('INTERNAL', '写入失败'));
    mocks.library = { ...mocks.library, favorites: [...mocks.library.favorites] };
    view.rerender(<RecommendationSyncBridge />);
    await waitFor(() => expect(warn).toHaveBeenCalledWith('曲库推荐同步失败', expect.anything()));
    mocks.library = { ...mocks.library, favorites: [...mocks.library.favorites] };
    view.rerender(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(3));
    expect(mocks.sync.mock.lastCall?.[0]).toMatchObject({ favorites: [song] });
    expect(mocks.sync.mock.lastCall?.[0].delta).toBeUndefined();
  });

  it('新增歌单成员及更新元数据仅发送必要增量，跳过虚拟收藏歌单', async () => {
    mocks.library.playlists = [{ id: 'favorites', name: '我喜欢', createTime: 0, songs: [song] }];
    const view = render(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    expect(mocks.sync.mock.lastCall?.[0].playlists).toEqual([]);
    const second = { ...song, id: '2' };
    const playlist = { id: 'p1', name: '夜晚', createTime: 1, songs: [second] };
    mocks.library = { favorites: [song], playlists: [playlist] };
    view.rerender(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    expect(mocks.sync.mock.lastCall?.[0].delta).toEqual({
      upsertSongs: [second], addedMemberships: [{ containerType: 'playlist', containerId: 'p1', trackKey: 'qq:2' }],
      removedMemberships: [],
    });
    const updated = { ...second, name: '修正后的歌曲' };
    mocks.library = { favorites: [song], playlists: [{ ...playlist, songs: [updated] }] };
    view.rerender(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(3));
    expect(mocks.sync.mock.lastCall?.[0].delta).toEqual({ upsertSongs: [updated], addedMemberships: [], removedMemberships: [] });
    mocks.library = { ...mocks.library, playlists: [...mocks.library.playlists] };
    view.rerender(<RecommendationSyncBridge />);
    await act(async () => {});
    expect(mocks.sync).toHaveBeenCalledTimes(3);
  });

  it('初始化 BUSY 后收到 ready 会自动补做全量同步', async () => {
    mocks.getConfig.mockRejectedValueOnce(new IpcError('BUSY', '初始化'));
    render(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalledOnce());
    expect(mocks.sync).not.toHaveBeenCalled();
    act(() => ready());
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ favorites: [song] })));
  });

  it('禁用后启用、清空后都重新同步完整曲库', async () => {
    mocks.getConfig.mockResolvedValueOnce({ localRecommendationEnabled: false });
    render(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalledOnce());
    expect(mocks.sync).not.toHaveBeenCalled();
    changed();
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    changed();
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    for (const [snapshot] of mocks.sync.mock.calls) {
      expect(snapshot.favorites).toEqual([song]);
      expect(snapshot.delta).toBeUndefined();
    }
  });

  it('并发修改再撤销时，不把过期的增量当作新基线', async () => {
    const view = render(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    let complete: (synced: boolean) => void = () => {};
    mocks.sync.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    mocks.library = { favorites: [], playlists: [] };
    view.rerender(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    expect(mocks.sync.mock.calls[1][0].delta.removedMemberships).toHaveLength(1);
    mocks.library = { favorites: [song], playlists: [] };
    view.rerender(<RecommendationSyncBridge />);
    await act(async () => complete(true));
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(3));
    expect(mocks.sync.mock.calls[2][0]).toMatchObject({ favorites: [song] });
    expect(mocks.sync.mock.calls[2][0].delta).toBeUndefined();
  });

  it('后端禁用返回 false 时不推进同步基线', async () => {
    mocks.sync.mockResolvedValueOnce(false);
    const view = render(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    mocks.library = { favorites: [song, { ...song, id: '2' }], playlists: [] };
    view.rerender(<RecommendationSyncBridge />);
    await waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(2));
    expect(mocks.sync.mock.calls[1][0].favorites).toHaveLength(2);
    expect(mocks.sync.mock.calls[1][0].delta).toBeUndefined();
  });
});
