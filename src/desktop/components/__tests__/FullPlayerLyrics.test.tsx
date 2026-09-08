import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FullPlayerLyrics from '../fullplayer/FullPlayerLyrics';
import { saveLyricDisplayMode } from '../../../core/utils/lyricDisplayMode';
import type { Song } from '../../../core/types';

const player = vi.hoisted(() => ({
  song: null as Song | null, loading: false, time: 0, offset: 0, seek: vi.fn(),
}));
vi.mock('../../../core/contexts/PlayerContext', () => ({
  usePlayerNowPlaying: () => ({ currentSong: player.song, isLoading: player.loading }),
  usePlayerProgress: () => ({ currentTime: player.time, lyricOffsetSeconds: player.offset }),
  usePlayerActions: () => ({ seek: player.seek }),
}));

const song: Song = { id: 'test', source: 'qq', name: '测试歌曲', artist: '歌手', album: '',
  lrc: '[1000,1000](1000,500,0)你(1500,500,0)好\n[3000,1000](3000,500,0)世(3500,500,0)界' };
let resize: ResizeObserverCallback;
const disconnect = vi.fn();
beforeEach(() => {
  player.song = song; player.loading = false; player.time = 1.1; player.offset = 0; player.seek.mockClear();
  localStorage.clear(); saveLyricDisplayMode('karaoke');
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {} disconnect = disconnect;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(60);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  vi.spyOn(HTMLElement.prototype, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('全屏歌词的稳定节点与滚动', () => {
  it('逐字推进与切行保持文字节点，不重复居中或重建动画', () => {
    const view = render(<FullPlayerLyrics isOpen />);
    const rows = screen.getAllByRole('listitem');
    const word = view.container.querySelector('.karaoke-word')!;
    expect(word.getAttribute('data-text')).toBe('你');
    expect(word.getAttribute('style')).toContain('20.0%');
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 380, behavior: 'auto' });
    player.time = 1.3; view.rerender(<FullPlayerLyrics isOpen />);
    expect(view.container.querySelector('.karaoke-word')).toBe(word);
    expect(word.getAttribute('style')).toContain('60.0%');
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(1);
    player.time = 3.1; view.rerender(<FullPlayerLyrics isOpen />);
    expect(screen.getAllByRole('listitem')[0]).toBe(rows[0]);
    expect(view.container.querySelector('.karaoke-word')).toBe(word);
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 380, behavior: 'smooth' });
  });

  it('越过原先的窗口边界不删除前面的行，换歌同一行号也会重新居中', () => {
    player.song = { ...song, lrc: Array.from({ length: 20 }, (_, index) =>
      `[00:${String(index * 2 + 1).padStart(2, '0')}.00]第 ${index} 行`).join('\n') };
    player.time = 17.1;
    const view = render(<FullPlayerLyrics isOpen />);
    const first = screen.getAllByRole('listitem')[0];
    player.time = 19.1; view.rerender(<FullPlayerLyrics isOpen />);
    expect(screen.getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getAllByRole('listitem')[0]).toBe(first);
    player.song = { ...player.song, source: 'netease' };
    view.rerender(<FullPlayerLyrics isOpen />);
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 380, behavior: 'auto' });
  });

  it('歌词支持鼠标和键盘跳转，窗口尺寸变化重新对齐并释放观察器', () => {
    const view = render(<FullPlayerLyrics isOpen />);
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(rows[1]);
    fireEvent.keyDown(rows[0], { key: 'Enter' });
    fireEvent.keyDown(rows[0], { key: ' ' });
    fireEvent.keyDown(rows[0], { key: 'Tab' });
    expect(player.seek.mock.calls).toEqual([[3], [1], [1]]);
    act(() => resize([], {} as ResizeObserver));
    expect(HTMLElement.prototype.scrollTo).toHaveBeenCalledTimes(1);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    act(() => resize([], {} as ResizeObserver));
    expect(HTMLElement.prototype.scrollTo).toHaveBeenLastCalledWith({ top: 430, behavior: 'auto' });
    view.unmount(); expect(disconnect).toHaveBeenCalled();
  });

  it('关闭、开头空档、无歌词、加载中和逐行模式正确显示', () => {
    player.time = 0;
    const view = render(<FullPlayerLyrics isOpen={false} />);
    expect(HTMLElement.prototype.scrollTo).not.toHaveBeenCalled();
    view.rerender(<FullPlayerLyrics isOpen />);
    expect(view.container.querySelector('[data-active]')).toBeNull();
    player.time = 1.1;
    view.rerender(<FullPlayerLyrics isOpen />);
    act(() => saveLyricDisplayMode('line'));
    expect(view.container.querySelector('.karaoke-word')).toBeNull();
    player.song = { ...song, lrc: undefined }; player.loading = true;
    view.rerender(<FullPlayerLyrics isOpen />);
    expect(screen.getByText('加载歌词中...')).toBeTruthy();
    player.loading = false; view.rerender(<FullPlayerLyrics isOpen />);
    expect(screen.getByText('测试歌曲')).toBeTruthy();
    player.song = null; view.rerender(<FullPlayerLyrics isOpen />);
    expect(screen.getByText('选择一首音乐开始')).toBeTruthy();
  });

  it('显示真实翻译和附加歌词，过滤服务返回的空翻译标记', () => {
    player.song = { ...song, lrc: '[tunefree:main]\n[00:01.00]你好\n[00:03.00]世界\n\n[tunefree:translation]\n[00:01.00]Hello\n[00:03.00]//' };
    const view = render(<FullPlayerLyrics isOpen />);
    expect(screen.getByText('Hello')).toBeTruthy();
    expect(view.container.querySelectorAll('.lyric-line em')).toHaveLength(1);
  });
});
