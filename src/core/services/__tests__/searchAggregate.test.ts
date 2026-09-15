import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../types';

vi.mock('../netease', () => ({ searchNetease: vi.fn(), getNeteaseTopLists: vi.fn(), getNeteaseTopListDetail: vi.fn() }));
vi.mock('../qq', () => ({ searchQQ: vi.fn(), getQQTopLists: vi.fn(), getQQTopListDetail: vi.fn() }));
vi.mock('../kuwo', () => ({ searchKuwo: vi.fn(), getKuwoTopLists: vi.fn(), getKuwoTopListDetail: vi.fn() }));
vi.mock('../kugou', () => ({ searchKugou: vi.fn() }));
vi.mock('../migu', () => ({ searchMigu: vi.fn() }));
import { searchAggregate, searchSongs, getTopLists, getTopListDetail } from '../api';
import { searchNetease, getNeteaseTopLists, getNeteaseTopListDetail } from '../netease';
import { searchQQ, getQQTopLists, getQQTopListDetail } from '../qq';
import { searchKuwo, getKuwoTopLists, getKuwoTopListDetail } from '../kuwo';
import { searchKugou } from '../kugou';
import { searchMigu } from '../migu';

const song: Song = { id: '1', source: 'netease', name: '歌曲', artist: '歌手', album: '' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(searchNetease).mockResolvedValue([]);
  vi.mocked(searchQQ).mockResolvedValue([]);
  vi.mocked(searchKuwo).mockResolvedValue([]);
  vi.mocked(searchKugou).mockResolvedValue([]);
  vi.mocked(searchMigu).mockResolvedValue([]);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

it('榜单和详情分发至所选平台，Joox 搜索沿用 GD 接口', async () => {
  for (const [source, lists, detail] of [['netease', getNeteaseTopLists, getNeteaseTopListDetail], ['qq', getQQTopLists, getQQTopListDetail], ['kuwo', getKuwoTopLists, getKuwoTopListDetail]] as const) {
    vi.mocked(lists).mockResolvedValue([{ id: '榜单', name: source }]); vi.mocked(detail).mockResolvedValue([song]);
    expect(await getTopLists(source)).toEqual([{ id: '榜单', name: source }]); expect(await getTopListDetail('榜单', source)).toEqual([song]); expect(detail).toHaveBeenCalledWith('榜单');
  }
  expect(await getTopLists('unknown')).toEqual([]); expect(await getTopListDetail('x', 'unknown')).toEqual([]);
  // JOOX / B 站由内置 GD 脚本提供搜索；单元测试里没有沙箱，因此没有归属该平台的 provider。
  expect(await searchSongs('关键词', 'joox', 1)).toEqual([]);
  // 酷狗 / 咪咕各自走独立搜索实现（不占用 GD 接口）。
  const kugouSong: Song = { ...song, source: 'kugou' };
  vi.mocked(searchKugou).mockResolvedValue([kugouSong]);
  expect(await searchSongs('关键词', 'kugou', 2)).toEqual([kugouSong]);
  expect(searchKugou).toHaveBeenCalledWith('关键词', 2, 30, undefined);
  const miguSong: Song = { ...song, source: 'migu' };
  vi.mocked(searchMigu).mockResolvedValue([miguSong]);
  expect(await searchSongs('关键词', 'migu', 1)).toEqual([miguSong]);
  expect(searchMigu).toHaveBeenCalledWith('关键词', 1, 30, undefined);
  expect(await searchSongs('关键词', 'unknown', 1)).toEqual([]);
});
afterEach(() => vi.restoreAllMocks());

describe('聚合搜索', () => {
  it('快源先展示结果，慢源完成后保留已有结果和失败信息', async () => {
    let finish: (songs: Song[]) => void = () => {};
    vi.mocked(searchNetease).mockResolvedValue([song]);
    vi.mocked(searchQQ).mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.mocked(searchKuwo).mockRejectedValue(new Error('暂不可用'));
    const onPartial = vi.fn();
    const controller = new AbortController();
    const pending = searchAggregate('歌曲', 1, { onPartial, signal: controller.signal });
    await vi.waitFor(() => expect(onPartial).toHaveBeenCalledWith([song], ['kuwo']));
    expect(searchQQ).toHaveBeenCalledWith('歌曲', 1, 30, controller.signal);
    finish([{ ...song, id: '2', source: 'qq' }]);
    expect(await pending).toHaveLength(2);
  });

  it('有效空列表与全部接口失败分别处理', async () => {
    expect(await searchAggregate('不存在')).toEqual([]);
    vi.mocked(searchNetease).mockRejectedValue(new Error('failed'));
    vi.mocked(searchQQ).mockRejectedValue(new Error('failed'));
    vi.mocked(searchKuwo).mockRejectedValue(new Error('failed'));
    await expect(searchAggregate('故障')).rejects.toThrow('所有搜索音源');
  });

  it('取消后停止发布部分结果，不再发起新搜索', async () => {
    const controller = new AbortController();
    const onPartial = vi.fn();
    const pending = searchAggregate('歌曲', 1, { signal: controller.signal, onPartial });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(onPartial).not.toHaveBeenCalled();
    vi.clearAllMocks();
    await expect(searchSongs('歌曲', 'netease', 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(searchNetease).not.toHaveBeenCalled();
  });
});
