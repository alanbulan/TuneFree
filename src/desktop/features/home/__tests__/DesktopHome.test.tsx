import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider } from '../../../../core/contexts/LibraryContext';
import { getTopListDetail, getTopLists } from '../../../../core/services/api';
import { getAIRecommendedSongs } from '../../../../core/services/gdStudio';
import { saveRecommendationFeedback } from '../../../../core/services/recommendation';
import { IpcError } from '../../../../core/ipc';
import { deferred } from '../../../../core/__tests__/deferred';
import type { Song, TopList } from '../../../../core/types';
import DesktopHome from '../DesktopHome';
import { ContextSearchPanel } from '../HomePanels';
import { useRecommendationJob } from '../useRecommendationJob';

const mocks = vi.hoisted(() => ({ play: vi.fn(), toast: vi.fn(), remove: vi.fn(), navigate: vi.fn(), busy: vi.fn() }));
vi.mock('../../../../core/contexts/PlayerContext', () => ({ usePlayerActions: () => ({ playQueue: mocks.play }),
  usePlayerNowPlaying: () => ({ currentSong: { id: 'playing', name: '灵感', artist: '歌手', album: '', source: 'qq' }, isPlaying: true }) }));
vi.mock('../../../../core/services/api', async (original) => ({ ...await original<typeof import('../../../../core/services/api')>(), getTopLists: vi.fn(), getTopListDetail: vi.fn() }));
vi.mock('../../../../core/services/gdStudio', () => ({ getAIRecommendedSongs: vi.fn() }));
vi.mock('../../../../core/services/recommendation', async (original) => ({ ...await original<typeof import('../../../../core/services/recommendation')>(),
  saveRecommendationFeedback: vi.fn(), logRecommendationEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../components/ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../useRecommendationJob', () => ({ useRecommendationJob: vi.fn() }));

const song: Song = { id: '1', name: '夜曲', artist: '歌手', album: '专辑', source: 'netease', pic: 'https://p.test/1.jpg' };
const chart: TopList = { id: 'chart', name: '热歌榜', coverImgUrl: 'https://p.test/chart.jpg', updateFrequency: '每日更新' };
const renderHome = () => render(<DesktopHome onViewChange={mocks.navigate} onAiBusyChange={mocks.busy} />, { wrapper: LibraryProvider });
const selectSource = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const ready = async () => { await act(async () => {}); };
let day = 0;
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); vi.setSystemTime(new Date(2030, 0, ++day, 20));
  vi.mocked(getTopLists).mockReset().mockResolvedValue([chart, { id: 'empty', name: '新歌榜' }]);
  vi.mocked(getTopListDetail).mockReset().mockResolvedValue([song]);
  vi.mocked(getAIRecommendedSongs).mockReset().mockResolvedValue([song]);
  vi.mocked(saveRecommendationFeedback).mockReset().mockResolvedValue(undefined);
  vi.mocked(useRecommendationJob).mockReturnValue({ songs: [], loading: false, initializing: false, error: '', removeSong: mocks.remove });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('首页榜单与操作', () => {
  it('榜单缓存复用，播放使用当前列表，收藏及撤销保留真实曲库状态', async () => {
    const view = renderHome(); await ready();
    expect(screen.getByText('我的歌单').nextElementSibling?.textContent).toBe('0');
    selectSource('网易云'); expect(getTopLists).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /热歌榜/ })); await ready();
    fireEvent.click(screen.getByRole('button', { name: '播放当前歌单' }));
    expect(mocks.play).toHaveBeenCalledWith([song], song);
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 夜曲' }));
    expect(screen.getByRole('button', { name: '取消收藏 夜曲' })).toBeTruthy();
    act(() => mocks.toast.mock.lastCall![2].onClick());
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 夜曲' }));
    fireEvent.click(screen.getByRole('button', { name: '取消收藏 夜曲' }));
    expect(mocks.toast).toHaveBeenLastCalledWith('已取消收藏', 'success', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: /热歌榜.*每日/ })); await ready();
    expect(getTopListDetail).toHaveBeenCalledTimes(1);
    selectSource('QQ'); await ready(); selectSource('网易云'); await ready();
    expect(getTopLists).toHaveBeenCalledTimes(2);
    view.unmount(); expect(mocks.busy).toHaveBeenLastCalledWith(false);
  });

  it('切换音源后旧榜单及歌曲请求不覆盖新结果，失败可见且能恢复', async () => {
    const lists = deferred<TopList[]>(); vi.mocked(getTopLists).mockReturnValueOnce(lists.promise);
    renderHome(); expect(document.querySelector('[aria-label="榜单加载中"]')).toBeTruthy();
    selectSource('QQ'); await ready();
    await act(async () => lists.resolve([{ id: 'old', name: '旧音源' }])); expect(screen.queryByText('旧音源')).toBeNull();
    const detail = deferred<Song[]>(); vi.mocked(getTopListDetail).mockReturnValueOnce(detail.promise);
    fireEvent.click(screen.getByRole('button', { name: /热歌榜/ })); await ready();
    expect(document.querySelector('[aria-label="歌曲加载中"]')).toBeTruthy();
    selectSource('酷我'); await ready(); await act(async () => detail.resolve([song]));
    expect(screen.queryByRole('button', { name: '立即播放 夜曲' })).toBeNull();
    vi.mocked(getTopListDetail).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: /热歌榜/ })); await ready();
    expect(screen.getByText('榜单歌曲暂时无法加载，请重新选择榜单或切换音源。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /热歌榜/ })); await ready();
    expect(screen.getByRole('button', { name: '立即播放 夜曲' })).toBeTruthy();
    vi.mocked(getTopLists).mockRejectedValueOnce(new Error('offline'));
    selectSource('网易云'); await ready();
    expect(screen.getByText('该音源暂不可用，请切换其他音源。')).toBeTruthy();
  });

  it.each([[2, '夜深了'], [8, '早上好'], [12, '中午好'], [16, '下午好'], [21, '晚上好']] as const)('在 %i 时显示 %s', async (hour, greeting) => {
    vi.setSystemTime(new Date(2031, 0, ++day, hour)); renderHome(); await ready();
    expect(screen.getByRole('heading', { name: greeting })).toBeTruthy();
  });

  it('曲库保存失败时不发成功提示', async () => {
    renderHome(); await ready(); fireEvent.click(screen.getByRole('button', { name: /热歌榜/ })); await ready();
    const storage = localStorage; vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage),
      setItem: () => { throw new Error('quota'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: '收藏歌曲 夜曲' })); expect(mocks.toast).not.toHaveBeenCalled();
  });
});

describe('AI 搜歌', () => {
  it('建议词只填充输入，提交后才生成；附带反馈元数据并响应播放', async () => {
    renderHome(); await ready(); selectSource('AI 搜歌');
    fireEvent.click(screen.getByRole('button', { name: '下雨天的咖啡馆' }));
    expect(getAIRecommendedSongs).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '描述想听的音乐' }));
    expect(screen.queryByRole('button', { name: '从这首歌出发' })).toBeNull();
    const input = screen.getByRole('textbox', { name: '描述想听的音乐' });
    expect((input as HTMLInputElement).value).toBe('下雨天的咖啡馆');
    fireEvent.change(input, { target: { value: ' 雨天 ' } });
    fireEvent.submit(input.closest('form')!); await ready();
    expect(getAIRecommendedSongs).toHaveBeenCalledWith('雨天', 'netease', 20, expect.any(AbortSignal));
    expect(mocks.busy).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '立即播放 夜曲' }));
    expect(saveRecommendationFeedback).toHaveBeenCalledWith(expect.objectContaining({ action: 'play' }));
    expect(mocks.play).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ recommendationRequestId: expect.stringMatching(/^embeat:/) }));
    expect(mocks.toast).toHaveBeenCalledWith('已生成 1 首语境歌曲', 'success');
  });

  it('取消和离开页面中断生成，迟到结果不改变新页面', async () => {
    const pending = deferred<Song[]>(); vi.mocked(getAIRecommendedSongs).mockReturnValueOnce(pending.promise);
    renderHome(); await ready(); selectSource('AI 搜歌');
    fireEvent.click(screen.getByRole('button', { name: '夜晚散步' })); fireEvent.submit(document.querySelector('.context-search-form')!);
    const signal = vi.mocked(getAIRecommendedSongs).mock.calls[0][3]!;
    fireEvent.click(screen.getByRole('button', { name: '停止生成' })); expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve([song])); expect(screen.queryByRole('button', { name: '立即播放 夜曲' })).toBeNull();
    const next = deferred<Song[]>(); vi.mocked(getAIRecommendedSongs).mockReturnValueOnce(next.promise);
    fireEvent.submit(document.querySelector('.context-search-form')!); selectSource('QQ');
    await act(async () => next.reject(new Error('cancelled')));
    expect(screen.queryByText('语境搜歌服务当前不可用，请稍后再试。')).toBeNull();
    expect(mocks.busy).toHaveBeenLastCalledWith(false);
  });

  it('空结果、限流及普通失败展示不同反馈，输入法 Enter 不提交', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderHome(); await ready(); selectSource('AI 搜歌');
    fireEvent.click(screen.getByRole('button', { name: '夜晚散步' }));
    const input = screen.getByRole('textbox', { name: '描述想听的音乐' });
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false);
    vi.mocked(getAIRecommendedSongs).mockResolvedValueOnce([]); fireEvent.submit(input.closest('form')!); await ready();
    expect(mocks.toast).toHaveBeenCalledWith('暂未找到符合意境的歌曲，换个词试试看', 'info');
    vi.mocked(getAIRecommendedSongs).mockRejectedValueOnce(new Error('RATE_LIMIT'));
    fireEvent.submit(input.closest('form')!); await ready(); expect(screen.getByText('语境搜歌请求过于频繁，请稍后再试。')).toBeTruthy();
    vi.mocked(getAIRecommendedSongs).mockRejectedValueOnce(new Error('offline'));
    fireEvent.submit(input.closest('form')!); await ready(); expect(screen.getByText('语境搜歌服务当前不可用，请稍后再试。')).toBeTruthy();
  });

  it('空输入和生成中的表单不能重复提交', () => {
    const handlers = { onSearch: vi.fn(), onCancel: vi.fn(), onQueryChange: vi.fn() };
    const view = render(<ContextSearchPanel query=" " loading={false} {...handlers} />);
    fireEvent.submit(document.querySelector('form')!); expect(handlers.onSearch).not.toHaveBeenCalled();
    view.rerender(<ContextSearchPanel query="雨天" loading {...handlers} />);
    fireEvent.submit(document.querySelector('form')!); expect(handlers.onSearch).not.toHaveBeenCalled();
  });
});

describe('推荐反馈', () => {
  it('正在初始化与失败可导航设置，反馈成功才从当前列表移除', async () => {
    const recommended: Song = { ...song, recommendationRequestId: 'request', recommendationSource: 'hybrid' };
    vi.mocked(useRecommendationJob).mockReturnValue({ songs: [recommended], loading: false, initializing: true, error: '推荐失败', removeSong: mocks.remove });
    renderHome(); await ready(); selectSource('为你推荐');
    expect(screen.getByText('推荐服务正在初始化，请稍候…')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开设置' })); expect(mocks.navigate).toHaveBeenCalledWith('settings');
    fireEvent.click(screen.getByRole('button', { name: '不感兴趣 夜曲' })); await ready();
    expect(mocks.remove).toHaveBeenCalledWith(recommended);
    vi.mocked(saveRecommendationFeedback).mockRejectedValueOnce(new IpcError('BUSY', '启动'));
    fireEvent.click(screen.getByRole('button', { name: '不感兴趣 夜曲' })); await ready();
    expect(mocks.toast).toHaveBeenLastCalledWith('推荐服务正在初始化，请稍后再试', 'info');
    vi.mocked(saveRecommendationFeedback).mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '不感兴趣 夜曲' })); await ready();
    expect(mocks.toast).toHaveBeenLastCalledWith('操作失败，请稍后再试', 'error'); expect(mocks.remove).toHaveBeenCalledTimes(1);
  });
});
