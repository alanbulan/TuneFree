import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedLyric } from '../../../src/core/utils/lyrics';
import { getDesktopLyricCurrentLine, useDesktopLyricBridge } from './useDesktopLyricBridge';
import { deferred } from '../../../src/core/__tests__/deferred';

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  disposed: [] as string[],
  invoked: [] as Array<{ command: string; args: unknown }>,
  emit: vi.fn().mockResolvedValue(undefined),
  registration: vi.fn(),
  ready: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/core/ipc', () => ({
  isTauri: () => true,
  emitEventTo: ipc.emit,
  invokeCommand: (command: string, args?: unknown) => {
    ipc.invoked.push({ command, args });
    return ipc.ready();
  },
  listenEvent: (event: string, handler: (payload: unknown) => void) => {
    ipc.handlers.set(event, handler);
    const dispose = () => {
      ipc.disposed.push(event);
      ipc.handlers.delete(event);
    };
    return ipc.registration(event) ?? Promise.resolve(dispose);
  },
}));

vi.mock('./theme', () => ({
  readAndApplyDesktopLyricTheme: () => ({ size: 22, font: 'system-ui', lock: false }),
}));

const rows: ParsedLyric[] = [
  { time: 20, text: '第一句' },
  { time: 25, text: '第二句' },
];

describe('getDesktopLyricCurrentLine', () => {
  it('previews the first row before its timestamp', () => {
    expect(getDesktopLyricCurrentLine(rows, -1)).toBe(rows[0]);
  });

  it('returns the active row after its timestamp is reached', () => {
    expect(getDesktopLyricCurrentLine(rows, 0)).toBe(rows[0]);
  });
});

const LRC_A = '[00:00.00]A 第一句\n[00:10.00]A 第二句';
const LRC_B = '[00:00.00]B 第一句';

const songPayload = (id: string, lrc: string | null) => ({
  trackKey: `netease:${id}`,
  id,
  title: `歌曲 ${id}`,
  artist: '歌手',
  source: 'netease',
  lrc,
  duration: 200,
});

const tickPayload = (id: string, currentTime: number, extra: Record<string, unknown> = {}) => ({
  trackKey: `netease:${id}`,
  currentTime,
  isPlaying: false,
  sentAt: Date.now(),
  playbackRate: 1,
  lyricOffsetSeconds: 0,
  lyricDisplayMode: 'line',
  ...extra,
});

const mountBridge = async () => {
  const view = renderHook(() => useDesktopLyricBridge());
  await act(async () => {
    await Promise.resolve();
  });
  return view;
};

const emit = (event: string, payload: unknown) => {
  act(() => {
    ipc.handlers.get(event)?.(payload);
  });
};

describe('useDesktopLyricBridge 事件消费', () => {
  beforeEach(() => {
    ipc.handlers.clear();
    ipc.disposed.length = 0;
    ipc.invoked.length = 0;
    ipc.emit.mockReset().mockResolvedValue(undefined);
    ipc.ready.mockReset().mockResolvedValue(undefined);
    ipc.registration.mockReset();
  });

  it('订阅拆分后的两个歌词事件', async () => {
    await mountBridge();
    expect([...ipc.handlers.keys()]).toEqual(
      expect.arrayContaining(['lyric-song', 'lyric-tick']),
    );
    expect(ipc.handlers.has('lyric-update')).toBe(false);
    expect(ipc.invoked).toContainEqual({ command: 'mark_desktop_lyric_ready', args: undefined });
    expect(ipc.emit).toHaveBeenCalledWith('main', 'desktop-lyric-ready', undefined);
  });

  it('隐藏页面没有动画帧时仍就绪，且等所有监听注册后才请求状态', async () => {
    const animation = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const pending = deferred<() => void>();
    ipc.registration.mockImplementation((event) => event === 'lyric-tick' ? pending.promise : undefined);
    const view = await mountBridge();
    expect(ipc.invoked).toEqual([]);
    expect(ipc.emit).not.toHaveBeenCalled();
    await act(async () => pending.resolve(vi.fn()));
    expect(ipc.invoked).toEqual([{ command: 'mark_desktop_lyric_ready', args: undefined }]);
    expect(ipc.emit).toHaveBeenCalledOnce();
    expect(animation).not.toHaveBeenCalled();
    view.unmount(); animation.mockRestore();
  });

  it('卸载发生在原生就绪确认期间时不再请求歌曲快照', async () => {
    const pending = deferred<void>();
    ipc.ready.mockReturnValueOnce(pending.promise);
    const view = await mountBridge();
    view.unmount();
    await act(async () => pending.resolve());
    expect(ipc.emit).not.toHaveBeenCalled();
  });

  it.each(['ready', 'emit'] as const)('%s 失败有明确日志且订阅仍可释放', async (step) => {
    const failure = new Error('窗口关闭');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    ipc[step].mockRejectedValueOnce(failure);
    const view = await mountBridge();
    expect(log).toHaveBeenCalledWith('Failed to setup desktop lyric bridge:', failure);
    view.unmount();
    expect(ipc.disposed).toContain('lyric-tick');
    log.mockRestore();
  });

  it('从 lyric-song 取歌曲与歌词，从 lyric-tick 取进度', async () => {
    const { result } = await mountBridge();

    emit('lyric-song', songPayload('a', LRC_A));
    expect(result.current.playerState.song).toMatchObject({
      id: 'a', name: '歌曲 a', artist: '歌手', lrc: LRC_A,
    });
    expect(result.current.playerState.rows).toHaveLength(2);

    emit('lyric-tick', tickPayload('a', 10.5));
    expect(result.current.playerState.currentTime).toBeCloseTo(10.5, 5);
    expect(result.current.playerState.activeIndex).toBe(1);
    expect(result.current.playerState.currentLine?.text).toBe('A 第二句');
    expect(result.current.playerState.isPlaying).toBe(false);
  });

  it('丢弃 trackKey 不匹配的过期 tick，避免串词', async () => {
    const { result } = await mountBridge();

    emit('lyric-song', songPayload('a', LRC_A));
    emit('lyric-tick', tickPayload('a', 10.5));
    expect(result.current.playerState.currentLine?.text).toBe('A 第二句');

    // 换歌时 tick 可能先于 lyric-song 抵达，此时绝不能继续渲染上一首的歌词。
    emit('lyric-tick', tickPayload('b', 0.2));
    expect(result.current.playerState.rows).toEqual([]);
    expect(result.current.playerState.activeIndex).toBe(-1);
    expect(result.current.playerState.currentLine).toBeNull();

    emit('lyric-song', songPayload('b', LRC_B));
    expect(result.current.playerState.rows).toHaveLength(1);
    expect(result.current.playerState.currentLine?.text).toBe('B 第一句');
  });

  it('清空 trackKey 的 lyric-song 会清掉当前歌曲', async () => {
    const { result } = await mountBridge();

    emit('lyric-song', songPayload('a', LRC_A));
    expect(result.current.playerState.song).not.toBeNull();

    emit('lyric-song', { ...songPayload('a', null), trackKey: '' });
    expect(result.current.playerState.song).toBeNull();
    expect(result.current.playerState.rows).toEqual([]);
  });

  it('归一化 tick 里的显示模式、倍速与歌词偏移', async () => {
    const { result } = await mountBridge();

    emit('lyric-song', songPayload('a', LRC_A));
    emit('lyric-tick', tickPayload('a', 1, {
      lyricDisplayMode: 'karaoke', playbackRate: 2, lyricOffsetSeconds: -0.5,
    }));
    expect(result.current.playerState.lyricDisplayMode).toBe('karaoke');
    expect(result.current.playerState.lyricOffsetSeconds).toBe(-0.5);

    emit('lyric-tick', tickPayload('a', 2, {
      lyricDisplayMode: '随便写的', playbackRate: Number.NaN, lyricOffsetSeconds: Number.NaN,
    }));
    expect(result.current.playerState.lyricDisplayMode).toBe('line');
    expect(result.current.playerState.lyricOffsetSeconds).toBe(0);
  });

  it('lock-change 事件直接翻转锁定态', async () => {
    const { result } = await mountBridge();
    expect(result.current.styleState.lock).toBe(false);

    emit('lock-change', true);
    expect(result.current.styleState.lock).toBe(true);
  });

  it('控制指令统一走 relay_player_control 命令', async () => {
    const { result } = await mountBridge();
    ipc.invoked.length = 0;
    act(() => result.current.controls.next());
    act(() => result.current.controls.adjustLyricSize(4));

    expect(ipc.invoked[0]).toEqual({
      command: 'relay_player_control', args: { action: 'next', value: undefined },
    });
    expect(ipc.invoked[1]).toEqual({
      command: 'relay_player_control', args: { action: 'adjust-lyric-size', value: 4 },
    });
    expect(result.current.styleState.size).toBe(36);
  });

  it('卸载时释放所有事件订阅', async () => {
    const { unmount } = await mountBridge();

    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(ipc.disposed).toEqual(expect.arrayContaining(['lyric-song', 'lyric-tick']));
    expect(ipc.handlers.has('lyric-tick')).toBe(false);
  });
});
