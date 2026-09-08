// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../../core/types';
import MiraPet from '../MiraPet';
import { bloubExpressions, bloubShapes, bloubStates } from '../bloubCatalog';

const nowPlaying = vi.hoisted(() => ({
  currentSong: null as Song | null,
  isPlaying: false,
  isLoading: false,
  isNearEnd: false,
}));

const progressHook = vi.hoisted(() => vi.fn(() => ({
  currentTime: 0, duration: 0, lyricOffsetSeconds: 0,
})));

vi.mock('../../../core/contexts/PlayerContext', () => ({
  usePlayerNowPlaying: () => nowPlaying,
  usePlayerProgress: progressHook,
}));

const song: Song = {
  id: '1', source: 'netease', name: '歌曲', artist: '歌手', album: '专辑',
};

const petHandle = () => screen.getByRole('button', { name: /^Bloub 音乐伙伴/ });
const petClassName = () => petHandle().closest('.bloub-companion')!.className;

describe('MiraPet 订阅面与情绪', () => {
  beforeEach(() => {
    localStorage.clear();
    progressHook.mockClear();
    nowPlaying.currentSong = song;
    nowPlaying.isPlaying = true;
    nowPlaying.isLoading = false;
    nowPlaying.isNearEnd = false;
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('不再订阅 10Hz 的播放进度', () => {
    render(<MiraPet />);
    expect(progressHook).not.toHaveBeenCalled();
  });

  it('只用低频的 isNearEnd 判定庆祝状态', () => {
    const { rerender } = render(<MiraPet />);
    expect(petClassName()).toContain('is-playing');
    expect(petClassName()).not.toContain('is-celebrate');

    nowPlaying.isNearEnd = true;
    rerender(<MiraPet />);
    expect(petClassName()).toContain('is-celebrate');
    expect(petHandle().title).toContain('快到结尾啦');
  });

  it('暂停、加载与空队列各自映射到不同情绪', () => {
    const { rerender } = render(<MiraPet />);

    nowPlaying.isPlaying = false;
    rerender(<MiraPet />);
    expect(petClassName()).toContain('is-paused');

    nowPlaying.isLoading = true;
    rerender(<MiraPet />);
    expect(petClassName()).toContain('is-loading');

    nowPlaying.isLoading = false;
    nowPlaying.currentSong = null;
    rerender(<MiraPet />);
    expect(petClassName()).toContain('is-empty');
  });

  it('接近结尾但已暂停时不进入庆祝状态', () => {
    nowPlaying.isPlaying = false;
    nowPlaying.isNearEnd = true;
    render(<MiraPet />);
    expect(petClassName()).toContain('is-paused');
  });

  it('设置里关闭桌宠时完全不渲染', () => {
    localStorage.setItem('tunefree_desktop_show_pet', 'false');
    render(<MiraPet />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('面板可触发全部官方动作、表情和外形，再恢复音乐状态', () => {
    render(<MiraPet />);
    fireEvent.click(screen.getByRole('button', { name: 'Bloub 动作与表情' }));
    const root = petHandle().closest('.bloub-companion')!;
    for (const choice of bloubStates) {
      fireEvent.click(screen.getByRole('button', { name: choice.label }));
      expect(root.getAttribute('data-state')).toBe(choice.id);
    }
    fireEvent.click(screen.getByRole('button', { name: '表情 16' }));
    for (const choice of bloubExpressions) {
      fireEvent.click(screen.getByRole('button', { name: choice.label }));
      expect(root.getAttribute('data-expression')).toBe(choice.id);
      expect(root.getAttribute('data-state')).toBe('idle');
    }
    fireEvent.click(screen.getByRole('button', { name: '外形 8' }));
    for (const choice of bloubShapes) {
      const button = screen.getByRole('button', { name: choice.label });
      fireEvent.click(button);
      expect(button.getAttribute('aria-pressed')).toBe('true');
      expect(root.getAttribute('data-state')).toBe('idle');
    }
    fireEvent.click(screen.getByRole('button', { name: '回到跟随音乐' }));
    expect(root.getAttribute('data-state')).toBe('orbit');
  });

  it('右键和键盘可开关面板，关闭后归还焦点', async () => {
    render(<MiraPet />);
    fireEvent.contextMenu(petHandle());
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bloub 动作与表情' }));
    fireEvent.keyDown(petHandle(), { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: '关闭动作面板' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.keyDown(petHandle(), { key: 'ContextMenu' });
    fireEvent.pointerDown(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('一次性动作结束后回到音乐状态，打招呼优先于预览', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<MiraPet />);
    fireEvent.click(screen.getByRole('button', { name: 'Bloub 动作与表情' }));
    fireEvent.click(screen.getByRole('button', { name: '彗星' }));
    act(() => vi.advanceTimersByTime(4200));
    expect(petHandle().closest('.bloub-companion')!.getAttribute('data-state')).toBe('orbit');
    fireEvent.keyDown(petHandle(), { key: 'Enter' });
    expect(petHandle().title).toContain('收到，你好呀');
    fireEvent.keyDown(petHandle(), { key: ' ' });
    expect(petHandle().title).toContain('把好心情送给你');
    act(() => vi.advanceTimersByTime(1800));
    expect(petHandle().title).toContain('好音乐');
  });

  it('AI 工作状态、设置开关与页面可见性实时生效', async () => {
    const view = render(<MiraPet aiBusy />);
    expect(petClassName()).toContain('is-thinking');
    await waitFor(() => expect(view.container.querySelector('.bloub-avatar')).not.toBeNull());
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(view.container.querySelector('.bloub-avatar')).toBeNull();
    localStorage.setItem('tunefree_desktop_show_pet', 'false');
    fireEvent(window, new Event('tunefree_pet_toggle'));
    expect(screen.queryByRole('button')).toBeNull();
    localStorage.setItem('tunefree_desktop_show_pet', 'true');
    fireEvent(window, new Event('tunefree_pet_toggle'));
    expect(petHandle()).toBeTruthy();
  });
});
