import { useState, type PropsWithChildren } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryProvider } from '../../../core/contexts/LibraryContext';
import { LIBRARY_KEY } from '../../../core/contexts/libraryStorage';
import { ThemeProvider } from '../../../core/contexts/ThemeContext';
import { deferred } from '../../../core/__tests__/deferred';
import type { RecommendationItem } from '../../../core/ipc';
import type { Song } from '../../../core/types';
import FullPlayerActions from '../fullplayer/FullPlayerActions';
import FullPlayerQueue from '../fullplayer/FullPlayerQueue';
import DesktopFullPlayer from '../DesktopFullPlayer';
import DesktopTransport from '../DesktopTransport';
import { DesktopLyricToggle, TransportMiniLyric } from '../DesktopTransportWidgets';

const mocks = vi.hoisted(() => ({
  song: null as Song | null, playing: false, loading: false, mode: 'sequence', queue: [] as Song[], time: 0,
  toast: vi.fn(), similar: vi.fn(), feedback: vi.fn(), download: vi.fn(), cancel: vi.fn(),
  downloading: false, cancelling: false, quality: null as null | 'flac', progress: null as number | null,
  actions: { playPrev: vi.fn(), playNext: vi.fn(), togglePlay: vi.fn(), togglePlayMode: vi.fn(),
    setAudioQuality: vi.fn(), playQueue: vi.fn(), playSong: vi.fn(), clearQueue: vi.fn(), removeFromQueue: vi.fn() },
}));
vi.mock('../../../core/contexts/PlayerContext', () => ({
  usePlayerNowPlaying: () => ({ currentSong: mocks.song, isPlaying: mocks.playing, isLoading: mocks.loading }),
  usePlayerQueueState: () => ({ queue: mocks.queue, playMode: mocks.mode }),
  usePlayerSettings: () => ({ audioQuality: 'flac' }),
  usePlayerProgress: () => ({ currentTime: mocks.time, lyricOffsetSeconds: 0 }),
  usePlayerActions: () => mocks.actions,
}));
vi.mock('../../../core/services/recommendation', async (original) => ({
  ...await original<typeof import('../../../core/services/recommendation')>(),
  getSimilarSongs: mocks.similar, saveRecommendationFeedback: mocks.feedback,
  logRecommendationEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../ToastHost', () => ({ useToast: () => ({ showToast: mocks.toast }) }));
vi.mock('../../hooks/useSongDownload', async (original) => ({
  ...await original<typeof import('../../hooks/useSongDownload')>(),
  useSongDownload: () => ({ handleDownload: mocks.download, cancelDownload: mocks.cancel,
    isDownloading: mocks.downloading, isCancelling: mocks.cancelling,
    downloadQuality: mocks.quality, downloadProgress: mocks.progress }),
}));
// 音频绘制和逐字计时各有独立测试，这里验证播放器操作与状态联动。
vi.mock('../../../core/components/AudioVisualizer', () => ({ default: () => null }));
vi.mock('../ConnectedProgressSlider', () => ({ default: () => null }));
vi.mock('../fullplayer/FullPlayerLyrics', () => ({ default: () => null }));

const song: Song = { id: '1', source: 'qq', name: '夜曲', artist: '歌手', album: '专辑', pic: 'https://img.test/1.jpg', lrc: '[00:01.00]第一句\n[00:03.00]第二句' };
const other: Song = { ...song, id: '2', name: '晴天' };
const item: RecommendationItem = { song: other, score: 1, reasons: ['相似'], recommendationSource: 'local', requestId: 'r' };
const ready = async () => { await act(async () => {}); };
const Providers = ({ children }: PropsWithChildren) => <ThemeProvider><LibraryProvider>{children}</LibraryProvider></ThemeProvider>;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
function Actions({ search = vi.fn() }: { search?: (query: string) => void }) {
  const [open, setOpen] = useState(false);
  return <FullPlayerActions showMorePanel={open} setShowMorePanel={setOpen} onSearch={search} />;
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); localStorage.setItem(LIBRARY_KEY, JSON.stringify({ favorites: [], playlists: [] }));
  mocks.song = song; mocks.queue = [song, other];
  mocks.playing = false; mocks.loading = false; mocks.mode = 'sequence'; mocks.time = 1.2;
  mocks.downloading = false; mocks.cancelling = false; mocks.quality = null; mocks.progress = null;
  mocks.similar.mockReset().mockResolvedValue([item]); mocks.feedback.mockReset().mockResolvedValue(undefined);
  mocks.download.mockResolvedValue(undefined); mocks.cancel.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('播放器操作', () => {
  it('更多面板支持搜索、真实收藏撤销和歌单创建、添加', () => {
    const search = vi.fn(); render(<Actions search={search} />, { wrapper: Providers });
    click('喜欢'); expect(screen.getByRole('button', { name: '已喜欢' })).toBeTruthy();
    act(() => mocks.toast.mock.lastCall![2].onClick()); click('喜欢'); click('已喜欢');
    expect(mocks.toast).toHaveBeenLastCalledWith('已取消收藏', 'success', expect.anything());
    click('更多'); expect(screen.getByRole('button', { name: '我喜欢 0 首' })).toBeTruthy();
    click('搜索歌手'); click('搜索专辑'); expect(search.mock.calls).toEqual([['歌手'], ['专辑']]);
    fireEvent.change(screen.getByPlaceholderText('新建歌单'), { target: { value: ' 深夜 ' } }); click('创建');
    expect(mocks.toast).toHaveBeenLastCalledWith('已创建「深夜」', 'success');
    click('深夜 已添加'); expect(screen.getByRole('button', { name: '深夜 已添加' })).toBeTruthy();
    click('离线缓存'); expect(mocks.download).toHaveBeenCalledWith(song, 'flac');
    click('128K'); expect(mocks.download).toHaveBeenLastCalledWith(song, '128k');
    click('更多');
  });

  it('写入失败不会报告收藏或创建成功', () => {
    render(<Actions />, { wrapper: Providers });
    const storage = localStorage;
    vi.stubGlobal('localStorage', { getItem: storage.getItem.bind(storage), setItem: () => { throw new Error('quota'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    click('喜欢'); click('更多'); fireEvent.change(screen.getByPlaceholderText('新建歌单'), { target: { value: '不能保存' } }); click('创建');
    expect(mocks.toast).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: '我喜欢 0 首' })).toBeTruthy();
  });

  it.each(['full', 'mini'] as const)('%s 相似音乐处理等待、空结果、失败及反馈失败', async (mode) => {
    render(mode === 'full' ? <Actions /> : <DesktopTransport onExpand={vi.fn()} />, { wrapper: Providers });
    const label = mode === 'full' ? '相似歌曲' : '播放相似音乐';
    const pending = deferred<RecommendationItem[]>(); mocks.similar.mockReturnValueOnce(pending.promise);
    click(label); expect(screen.getByRole('button', { name: mode === 'full' ? '计算中' : label }).hasAttribute('disabled')).toBe(true);
    mocks.feedback.mockRejectedValueOnce(new Error('反馈失败'));
    await act(async () => pending.resolve([item]));
    expect(mocks.actions.playQueue).toHaveBeenCalledWith([expect.objectContaining({ id: '2', recommendationRequestId: 'r' })], expect.objectContaining({ id: '2' }));
    expect(mocks.toast).toHaveBeenLastCalledWith('已载入 1 首相似歌曲', 'success');
    mocks.similar.mockResolvedValueOnce([]); click(label); await ready(); expect(mocks.toast.mock.lastCall![1]).toBe('info');
    mocks.similar.mockRejectedValueOnce(new Error('offline')); click(label); await ready(); expect(mocks.toast.mock.lastCall![1]).toBe('error');
    expect(screen.getByRole('button', { name: label }).hasAttribute('disabled')).toBe(false);
  });

  it('系统分享、剪贴板、取消与分享错误各自正确反馈', async () => {
    const share = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    render(<Actions />, { wrapper: Providers }); click('更多'); click('分享'); await ready();
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: '夜曲' }));
    expect(mocks.toast).toHaveBeenLastCalledWith('已打开系统分享', 'success');
    share.mockRejectedValueOnce(new DOMException('cancel', 'AbortError')); mocks.toast.mockClear(); click('分享'); await ready(); expect(mocks.toast).not.toHaveBeenCalled();
    share.mockRejectedValueOnce(new Error('拒绝')); click('分享'); await ready(); expect(mocks.toast.mock.lastCall![1]).toBe('error');
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    click('分享'); await ready(); expect(write).toHaveBeenCalledWith(expect.stringContaining('歌手 - 夜曲'));
    expect(mocks.toast).toHaveBeenLastCalledWith('已复制分享文案', 'success');
  });

  it('底栏的播放、音质、收藏、下载和展开都走对应动作', async () => {
    const expand = vi.fn(); const view = render(<DesktopTransport onExpand={expand} />, { wrapper: Providers });
    click('打开全屏播放器'); click('打开全屏歌词'); expect(expand).toHaveBeenCalledTimes(2);
    click('上一首'); click('下一首'); click('播放或暂停'); click('切换播放模式');
    expect(mocks.actions.playPrev).toHaveBeenCalled(); expect(mocks.actions.playNext).toHaveBeenCalledWith(true); expect(mocks.actions.togglePlay).toHaveBeenCalled();
    click('Hi-Res'); expect(mocks.actions.setAudioQuality).toHaveBeenCalledWith('flac24bit');
    click('喜欢当前歌曲'); act(() => mocks.toast.mock.lastCall![2].onClick()); click('喜欢当前歌曲'); click('取消喜欢');
    click('下载当前歌曲'); expect(mocks.download).toHaveBeenCalledWith(song, 'flac');
    mocks.downloading = true; mocks.playing = true; mocks.mode = 'shuffle'; view.rerender(<DesktopTransport onExpand={expand} />);
    click('取消下载'); expect(mocks.cancel).toHaveBeenCalled();
    mocks.cancelling = true; mocks.progress = 12; mocks.loading = true; mocks.mode = 'loop'; view.rerender(<DesktopTransport onExpand={expand} />);
    expect(screen.getByRole('button', { name: '取消下载' }).hasAttribute('disabled')).toBe(true);
    mocks.cancelling = false; view.rerender(<DesktopTransport onExpand={expand} />); expect(screen.getByText('12%')).toBeTruthy();
    mocks.song = null; mocks.downloading = false; mocks.playing = false; view.rerender(<DesktopTransport onExpand={expand} />);
    expect(screen.getByRole('button', { name: '播放或暂停' }).hasAttribute('disabled')).toBe(true);
  });

  it('全屏播放器支持键盘退出、焦点恢复和底部控制', () => {
    const focus = document.createElement('button'); document.body.append(focus); focus.focus();
    const close = vi.fn(); const view = render(<DesktopFullPlayer isOpen onClose={close} onSearch={vi.fn()} />, { wrapper: Providers });
    click('上一首'); click('下一首'); click('播放或暂停'); click('切换播放模式');
    fireEvent.click(within(screen.getByRole('group', { name: '播放音质' })).getByRole('button', { name: '320K' }));
    expect(mocks.actions.setAudioQuality).toHaveBeenCalledWith('320k');
    click('喜欢当前歌曲'); act(() => mocks.toast.mock.lastCall![2].onClick()); click('喜欢当前歌曲'); click('取消喜欢');
    fireEvent.keyDown(window, { key: 'Enter' }); fireEvent.keyDown(window, { key: 'Escape' }); click('收起播放器');
    fireEvent.click(view.container.querySelector('.full-player-backdrop')!); expect(close).toHaveBeenCalledTimes(3);
    mocks.song = null; mocks.queue = []; mocks.mode = 'shuffle'; view.rerender(<DesktopFullPlayer isOpen={false} onClose={close} onSearch={vi.fn()} />);
    expect(document.activeElement).toBe(focus); expect(screen.getByText('未在播放', { selector: 'h2' })).toBeTruthy();
    mocks.song = song; mocks.playing = true; mocks.loading = true; mocks.mode = 'loop'; view.rerender(<DesktopFullPlayer isOpen onClose={close} onSearch={vi.fn()} />);
    view.unmount(); focus.remove();
  });

  it('下载状态允许取消并显示进度，没有歌曲时禁用动作', () => {
    mocks.downloading = true; mocks.quality = 'flac'; mocks.progress = 42;
    const view = render(<Actions />, { wrapper: Providers }); click('取消下载'); expect(mocks.cancel).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '下载中 42%' }).hasAttribute('disabled')).toBe(true);
    view.unmount(); mocks.progress = null; mocks.cancelling = true;
    const next = render(<Actions />, { wrapper: Providers }); expect(screen.getByRole('button', { name: '取消中' }).hasAttribute('disabled')).toBe(true); expect(screen.getByText('获取中')).toBeTruthy();
    next.unmount(); mocks.song = null; mocks.quality = null; mocks.cancelling = false;
    render(<Actions />, { wrapper: Providers }); expect(screen.getByRole('button', { name: '喜欢' }).hasAttribute('disabled')).toBe(true);
  });

  it('队列清空和删除可撤销，并区分没有待播歌曲', () => {
    const view = render(<FullPlayerQueue />); click('播放 晴天'); expect(mocks.actions.playSong).toHaveBeenCalledWith(other);
    click('列表循环'); expect(mocks.actions.togglePlayMode).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: '从队列移除' })[1]); expect(mocks.actions.removeFromQueue).toHaveBeenCalledWith('2', 'qq');
    act(() => mocks.toast.mock.lastCall![2].onClick()); expect(mocks.actions.playQueue).toHaveBeenLastCalledWith([song, other], song);
    click('清空待播队列'); expect(mocks.actions.clearQueue).toHaveBeenCalled(); act(() => mocks.toast.mock.lastCall![2].onClick());
    view.unmount(); mocks.queue = []; mocks.song = null; render(<FullPlayerQueue />); click('清空待播队列');
    expect(mocks.toast).toHaveBeenLastCalledWith('没有待播歌曲需要清空', 'info');
  });

  it('桌面歌词开关完整循环和右键解锁，迷你歌词按时间换行', () => {
    const view = render(<><DesktopLyricToggle /><TransportMiniLyric onExpand={vi.fn()} /></>, { wrapper: Providers });
    click('打开桌面歌词'); click('锁定桌面歌词'); click('关闭桌面歌词');
    fireEvent.contextMenu(screen.getByRole('button', { name: '打开桌面歌词' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: '锁定桌面歌词' }));
    fireEvent.contextMenu(screen.getByRole('button', { name: '关闭桌面歌词' }));
    expect(mocks.toast).toHaveBeenLastCalledWith('桌面歌词已解锁', 'success');
    expect(screen.getByText('第一句')).toBeTruthy(); mocks.time = 3.2;
    view.rerender(<><DesktopLyricToggle /><TransportMiniLyric onExpand={vi.fn()} /></>); expect(screen.getByText('第二句')).toBeTruthy();
  });
});
