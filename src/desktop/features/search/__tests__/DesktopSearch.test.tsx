import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider } from '../../../../core/contexts/LibraryContext';
import { searchAggregate, searchSongs } from '../../../../core/services/api';
import { deferred } from '../../../../core/__tests__/deferred';
import type { Song } from '../../../../core/types';
import DesktopSearch from '../DesktopSearch';
import { useSearchHistory } from '../useSearchHistory';

const mocks = vi.hoisted(() => ({ play: vi.fn(), toast: vi.fn() }));
vi.mock('../../../../core/contexts/PlayerContext', () => ({ usePlayerActions: () => ({ playQueue: mocks.play }),
  usePlayerNowPlaying: () => ({ currentSong: null, isPlaying: false }) }));
vi.mock('../../../../core/services/api', async (original) => ({ ...await original<typeof import('../../../../core/services/api')>(), searchAggregate: vi.fn(), searchSongs: vi.fn() }));
vi.mock('../../../../core/services/recommendation', async (original) => ({ ...await original<typeof import('../../../../core/services/recommendation')>(), logRecommendationEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));

const song = (id: string): Song => ({ id, name: `歌曲 ${id}`, artist: '歌手', album: '专辑', source: 'netease' });
const renderSearch = (commandQuery = '') => render(<DesktopSearch commandQuery={commandQuery} />, { wrapper: LibraryProvider });
const input = () => screen.getByRole('textbox');
const searchNow = async () => { fireEvent.keyDown(input(), { key: 'Enter' }); await act(async () => {}); };
const debounce = async () => { await act(() => vi.advanceTimersByTimeAsync(300)); };
beforeEach(() => {
  vi.useFakeTimers(); localStorage.clear(); vi.clearAllMocks();
  vi.mocked(searchAggregate).mockReset().mockResolvedValue([song('1')]);
  vi.mocked(searchSongs).mockReset().mockResolvedValue([song('single')]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('搜索请求生命周期', () => {
  it('读取命令查询并防抖，播放完整结果、收藏和撤销，分页去重后结束', async () => {
    localStorage.setItem('tunefree_desktop_pending_query', '夜曲'); renderSearch();
    expect((input() as HTMLInputElement).value).toBe('夜曲'); expect(localStorage.getItem('tunefree_desktop_pending_query')).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(299)); expect(searchAggregate).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(searchAggregate).toHaveBeenCalledWith('夜曲', 1, expect.objectContaining({ includeExtendedSources: false }));
    fireEvent.click(screen.getByRole('button', { name: '立即播放 歌曲 1' })); expect(mocks.play).toHaveBeenCalledWith([song('1')], song('1'));
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 歌曲 1' }));
    expect(screen.getByRole('button', { name: '取消收藏 歌曲 1' })).toBeTruthy();
    act(() => mocks.toast.mock.lastCall![2].onClick());
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 歌曲 1' }));
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 歌曲 1' }));
    expect(mocks.toast).toHaveBeenLastCalledWith('已取消收藏', 'success', expect.anything());
    vi.mocked(searchAggregate).mockResolvedValueOnce([song('1'), song('2')]);
    const more = screen.getByRole('button', { name: '加载更多结果' }); fireEvent.click(more); fireEvent.click(more); await debounce();
    expect(vi.mocked(searchAggregate).mock.calls[1][1]).toBe(2); expect(searchAggregate).toHaveBeenCalledTimes(2);
    expect(document.querySelectorAll('.song-row:not(.skeleton-song-row)')).toHaveLength(2);
    vi.mocked(searchAggregate).mockResolvedValueOnce([song('2')]);
    fireEvent.scroll(document.querySelector('.song-virtual-list')!, { target: { scrollTop: 10 } }); await debounce();
    expect(screen.queryByRole('button', { name: '加载更多结果' })).toBeNull();
    expect(JSON.parse(localStorage.getItem('tunefree_search_history')!)).toEqual(['夜曲']);
  });

  it('输入变化立即取消旧请求，迟到的局部及最终结果不能回写', async () => {
    const old = deferred<Song[]>(); vi.mocked(searchAggregate).mockReturnValueOnce(old.promise);
    const view = renderSearch('旧'); await debounce();
    const options = vi.mocked(searchAggregate).mock.calls[0][2]!;
    act(() => options.onPartial?.([song('partial')], ['qq']));
    expect(screen.getByRole('button', { name: '立即播放 歌曲 partial' })).toBeTruthy();
    expect(screen.getByText('部分音源暂不可用：QQ')).toBeTruthy();
    fireEvent.change(input(), { target: { value: '新' } }); expect(options.signal?.aborted).toBe(true);
    act(() => options.onPartial?.([song('late')], [])); await act(async () => old.resolve([song('old')]));
    expect(screen.queryByText('歌曲 old')).toBeNull(); expect(screen.queryByText('歌曲 late')).toBeNull();
    await debounce(); expect(searchAggregate).toHaveBeenLastCalledWith('新', 1, expect.anything());
    view.rerender(<DesktopSearch commandQuery="命令" commandNonce={1} />); await debounce();
    expect(searchAggregate).toHaveBeenLastCalledWith('命令', 1, expect.anything());
    view.rerender(<DesktopSearch commandQuery="" commandNonce={2} />); await debounce();
    expect((input() as HTMLInputElement).value).toBe('命令');
  });

  it('Enter 立即搜索清掉防抖，无关键词不发请求，空历史清除是无操作', async () => {
    renderSearch(); fireEvent.click(screen.getByRole('button', { name: '清空历史' })); expect(mocks.toast).not.toHaveBeenCalled();
    await searchNow(); expect(mocks.toast).toHaveBeenCalledWith('请输入关键词后再搜索', 'warning');
    fireEvent.change(input(), { target: { value: ' 首歌 ' } }); await searchNow();
    await debounce(); expect(searchAggregate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '清空历史' })); expect(screen.getByText('暂无历史记录')).toBeTruthy();
    act(() => mocks.toast.mock.lastCall![2].onClick()); expect(screen.getByRole('button', { name: '首歌' })).toBeTruthy();
    fireEvent.change(input(), { target: { value: '' } }); fireEvent.click(screen.getByRole('button', { name: '首歌' })); await searchNow();
    expect(JSON.parse(localStorage.getItem('tunefree_search_history')!)).toEqual(['首歌']);
  });

  it('扩展源提示随模式更新，指定音源失败提示公开接口频控，重试成功', async () => {
    renderSearch('雨天'); await debounce();
    fireEvent.click(screen.getByRole('button', { name: '扩展源 关' })); await debounce();
    expect(localStorage.getItem('tunefree_aggregate_extended_sources')).toBe('1');
    expect(screen.getByText(/扩展聚合已启用/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '指定音源' }));
    vi.mocked(searchSongs).mockRejectedValueOnce(new Error('RATE_LIMIT'));
    fireEvent.click(screen.getByRole('radio', { name: /JOOX/ })); await debounce();
    expect(screen.getByText(/当前不可用，或可能触发了公开接口频控/)).toBeTruthy();
    await searchNow(); expect(screen.getByRole('button', { name: '立即播放 歌曲 single' })).toBeTruthy();
    vi.mocked(searchSongs).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('radio', { name: /QQ/ })); await debounce();
    expect(screen.getByText('搜索失败，请稍后重试。')).toBeTruthy();
  });

  it('取消失败静默，翻页失败保留已显示结果，卸载中止网络请求', async () => {
    const pending = deferred<Song[]>(); vi.mocked(searchAggregate).mockReturnValueOnce(pending.promise);
    const view = renderSearch('旧'); await debounce(); fireEvent.change(input(), { target: { value: '新' } });
    await act(async () => pending.reject(new Error('abort'))); expect(screen.queryByText('搜索失败，请稍后重试。')).toBeNull();
    await debounce(); vi.mocked(searchAggregate).mockRejectedValueOnce(new Error('page failed'));
    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' })); await debounce();
    expect(screen.getByRole('button', { name: '立即播放 歌曲 1' })).toBeTruthy();
    expect(screen.getByText('搜索失败，请稍后重试。')).toBeTruthy();
    const leaving = deferred<Song[]>(); vi.mocked(searchAggregate).mockReturnValueOnce(leaving.promise);
    fireEvent.change(input(), { target: { value: '离开' } }); await debounce();
    const signal = vi.mocked(searchAggregate).mock.lastCall![2]?.signal; view.unmount(); expect(signal?.aborted).toBe(true);
    await act(async () => leaving.resolve([]));
  });

  it('收藏落盘失败不显示成功提示', async () => {
    renderSearch('歌'); await debounce(); const storage = localStorage;
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 歌曲 1' })); expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('搜索历史边界', () => {
  it.each(['broken', '{}', JSON.stringify(['一', null, '二'])])('容忍历史存储 %s', (stored) => {
    localStorage.setItem('tunefree_search_history', stored);
    const { result } = renderHook(useSearchHistory);
    expect(result.current.history).toEqual(stored.startsWith('[') ? ['一', '二'] : []);
    act(() => { result.current.addToHistory(' '); result.current.addToHistory('新'); result.current.addToHistory('新'); });
    expect(result.current.history.filter((word) => word === '新')).toHaveLength(1);
  });
  it('最多保留 18 条且存储失败可继续搜索', () => {
    localStorage.setItem('tunefree_search_history', JSON.stringify(Array.from({ length: 25 }, (_, index) => `历史${index}`)));
    const { result } = renderHook(useSearchHistory); expect(result.current.history).toHaveLength(18);
    const storage = localStorage; vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota'); } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    act(() => result.current.addToHistory('最新')); expect(result.current.history[0]).toBe('最新'); expect(warn).toHaveBeenCalled();
  });
});
