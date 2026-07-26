// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../../core/types';
import MiraPet from '../MiraPet';

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

const petClassName = () => screen.getByRole('button').className;

describe('MiraPet 订阅面与情绪', () => {
  beforeEach(() => {
    localStorage.clear();
    progressHook.mockClear();
    nowPlaying.currentSong = song;
    nowPlaying.isPlaying = true;
    nowPlaying.isLoading = false;
    nowPlaying.isNearEnd = false;
  });

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
    expect(screen.getByRole('button').title).toContain('快到结尾啦');
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
});
