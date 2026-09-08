// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../../core/types';
import LyricSyncBridge from '../LyricSyncBridge';

interface EmittedEvent {
  target: string;
  event: string;
  payload: Record<string, unknown>;
}

const bridge = vi.hoisted(() => ({
  currentSong: null as Song | null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  lyricOffsetSeconds: 0,
  lyricDisplayMode: 'line' as string,
  showDesktopLyric: true,
}));

const ipc = vi.hoisted(() => ({
  fail: false,
  emitted: [] as EmittedEvent[],
  listeners: new Map<string, (payload: unknown) => void>(),
}));

vi.mock('../../../core/contexts/PlayerContext', () => ({
  usePlayerNowPlaying: () => ({
    currentSong: bridge.currentSong,
    isPlaying: bridge.isPlaying,
    isLoading: false,
    isNearEnd: false,
  }),
  usePlayerProgress: () => ({
    currentTime: bridge.currentTime,
    duration: bridge.duration,
    lyricOffsetSeconds: bridge.lyricOffsetSeconds,
  }),
}));

vi.mock('../../../core/contexts/ThemeContext', () => ({
  useTheme: () => ({ showDesktopLyric: bridge.showDesktopLyric }),
}));

vi.mock('../../../core/hooks/useLyricDisplayMode', () => ({
  useLyricDisplayMode: () => bridge.lyricDisplayMode,
}));

vi.mock('../../../core/ipc', () => ({
  isTauri: () => true,
  emitEventTo: (target: string, event: string, payload: Record<string, unknown>) => {
    if (ipc.fail) return Promise.reject(new Error('窗口已关闭'));
    ipc.emitted.push({ target, event, payload });
    return Promise.resolve();
  },
  listenEvent: (event: string, handler: (payload: unknown) => void) => {
    if (ipc.fail) return Promise.reject(new Error('事件不可用'));
    ipc.listeners.set(event, handler);
    return Promise.resolve(() => ipc.listeners.delete(event));
  },
}));

const song = (id: string, lrc: string | null): Song => ({
  id,
  source: 'netease',
  name: `歌曲 ${id}`,
  artist: '歌手',
  album: '专辑',
  lrc: lrc ?? undefined,
});

const payloadsOf = (event: string) =>
  ipc.emitted.filter((item) => item.event === event).map((item) => item.payload);

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderBridge = async () => {
  const view = render(<LyricSyncBridge />);
  await flush();
  return view;
};

/** Re-render with whatever `bridge` currently holds and let the emit promises settle. */
const applyState = async (rerender: (ui: React.ReactElement) => void) => {
  await act(async () => {
    rerender(<LyricSyncBridge />);
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('LyricSyncBridge 事件拆分', () => {
  beforeEach(() => {
    ipc.fail = false;
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    ipc.emitted.length = 0;
    ipc.listeners.clear();
    bridge.currentSong = song('a', '[00:01.00]第一句');
    bridge.isPlaying = true;
    bridge.currentTime = 0;
    bridge.duration = 200;
    bridge.lyricOffsetSeconds = 0;
    bridge.lyricDisplayMode = 'line';
    bridge.showDesktopLyric = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('窗口和事件通道失败时记录错误，不产生未处理的异步异常', async () => {
    ipc.fail = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await renderBridge();
    for (const message of ['同步歌词曲目信息失败:', '同步歌词进度失败:', '监听歌词窗口就绪事件失败:']) {
      expect(error).toHaveBeenCalledWith(message, expect.any(Error));
    }
  });

  it('换歌时下发一次带完整歌词的 lyric-song', async () => {
    await renderBridge();

    const songs = payloadsOf('lyric-song');
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({
      trackKey: 'netease:a',
      title: '歌曲 a',
      artist: '歌手',
      lrc: '[00:01.00]第一句',
      duration: 200,
    });
    expect(ipc.emitted.every((item) => item.target === 'desktop-lyric')).toBe(true);
    expect(ipc.emitted[0].event).toBe('lyric-song');
  });

  it('心跳只带标量，绝不携带歌词文本', async () => {
    await renderBridge();

    const ticks = payloadsOf('lyric-tick');
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      expect(tick).not.toHaveProperty('lrc');
      expect(tick).not.toHaveProperty('tlyric');
      expect(tick).toMatchObject({ trackKey: 'netease:a', isPlaying: true });
      expect(typeof tick.sentAt).toBe('number');
    }
  });

  it('同一首歌的歌词补全会重新下发全量', async () => {
    const { rerender } = await renderBridge();
    ipc.emitted.length = 0;

    bridge.currentSong = song('a', '[00:01.00]第一句\n[00:05.00]第二句');
    await applyState(rerender);

    expect(payloadsOf('lyric-song')).toHaveLength(1);
    expect(payloadsOf('lyric-song')[0].lrc).toContain('第二句');
  });

  it('500ms 内的连续进度更新被节流掉', async () => {
    const { rerender } = await renderBridge();
    ipc.emitted.length = 0;

    for (const [elapsed, time] of [[100, 0.3], [200, 0.6], [300, 0.9]] as const) {
      vi.setSystemTime(1_700_000_000_000 + elapsed);
      bridge.currentTime = time;
      await applyState(rerender);
    }
    expect(payloadsOf('lyric-tick')).toHaveLength(0);

    vi.setSystemTime(1_700_000_000_000 + 600);
    bridge.currentTime = 1.2;
    await applyState(rerender);
    expect(payloadsOf('lyric-tick')).toHaveLength(1);
    expect(payloadsOf('lyric-tick')[0]).toMatchObject({ currentTime: 1.2 });
  });

  it('seek 跳变绕过节流立即同步', async () => {
    const { rerender } = await renderBridge();
    ipc.emitted.length = 0;

    vi.setSystemTime(1_700_000_000_000 + 80);
    bridge.currentTime = 96;
    await applyState(rerender);

    expect(payloadsOf('lyric-tick')).toHaveLength(1);
    expect(payloadsOf('lyric-tick')[0]).toMatchObject({ currentTime: 96 });
  });

  it('播放状态与歌词设置变化绕过节流立即同步', async () => {
    const { rerender } = await renderBridge();
    ipc.emitted.length = 0;

    vi.setSystemTime(1_700_000_000_000 + 60);
    bridge.isPlaying = false;
    await applyState(rerender);
    expect(payloadsOf('lyric-tick')).toHaveLength(1);
    expect(payloadsOf('lyric-tick')[0]).toMatchObject({ isPlaying: false });

    ipc.emitted.length = 0;
    vi.setSystemTime(1_700_000_000_000 + 90);
    bridge.lyricOffsetSeconds = -0.4;
    await applyState(rerender);
    expect(payloadsOf('lyric-tick')).toHaveLength(1);
    expect(payloadsOf('lyric-tick')[0]).toMatchObject({ lyricOffsetSeconds: -0.4 });
  });

  it('收到 desktop-lyric-ready 时补发全量，消除暂停开窗的空白', async () => {
    bridge.isPlaying = false;
    await renderBridge();
    ipc.emitted.length = 0;

    const ready = ipc.listeners.get('desktop-lyric-ready');
    expect(ready).toBeTypeOf('function');

    await act(async () => {
      ready?.(undefined);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ipc.emitted.map((item) => item.event)).toEqual(['lyric-song', 'lyric-tick']);
    expect(payloadsOf('lyric-song')[0]).toMatchObject({ lrc: '[00:01.00]第一句' });
    expect(payloadsOf('lyric-tick')[0]).toMatchObject({ isPlaying: false });
  });

  it('桌面歌词关闭时不向歌词窗口发送任何事件', async () => {
    bridge.showDesktopLyric = false;
    const { rerender } = await renderBridge();

    vi.setSystemTime(1_700_000_000_000 + 5000);
    bridge.currentTime = 42;
    await applyState(rerender);

    expect(ipc.emitted).toHaveLength(0);
  });

  it('卸载后不再持有 desktop-lyric-ready 监听', async () => {
    const { unmount } = await renderBridge();
    expect(ipc.listeners.has('desktop-lyric-ready')).toBe(true);

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(ipc.listeners.has('desktop-lyric-ready')).toBe(false);
  });
});
