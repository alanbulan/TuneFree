import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ currentTime: 0, getter: undefined as undefined | (() => { currentTime: number; playbackRate: number; advancing: boolean }) }));
vi.mock('../../contexts/PlayerContext', () => ({ usePlayerProgress: () => ({ currentTime: state.currentTime, getPlaybackClock: state.getter }) }));
import { useLyricClock } from '../useLyricClock';
const frames = new Map<number, FrameRequestCallback>(); let id = 0;
const step = (time: number) => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); });
beforeEach(() => {
  frames.clear(); id = 0; state.currentTime = 1; state.getter = undefined;
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((frame: number) => frames.delete(frame)));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('歌词本地真实媒体时钟', () => {
  it('开始采样立即读取真实时钟，120Hz帧最多30Hz更新，seek和倍速只以真实媒体值为准', () => {
    let mediaTime = 1.234;
    const read = vi.fn(() => ({ currentTime: mediaTime, playbackRate: 2, advancing: true }));
    state.getter = read;
    const view = renderHook(() => useLyricClock(true));
    expect(view.result.current).toBe(1.234);
    read.mockClear(); mediaTime = 1.25;
    for (let time = 1000 / 120; time <= 1000; time += 1000 / 120) step(time);
    expect(read.mock.calls.length).toBeLessThanOrEqual(30);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(view.result.current).toBe(1.25);
    mediaTime = 86.5; step(1050); expect(view.result.current).toBe(86.5);
    mediaTime = 0.01; step(1090); expect(view.result.current).toBe(0.01);
    step(1130); expect(view.result.current).toBe(0.01);
    view.unmount(); expect(frames.size).toBe(0);
  });

  it('关闭歌词或旧进度context无getter时使用共享时钟，不启动帧', () => {
    const view = renderHook(({ enabled }) => useLyricClock(enabled), { initialProps: { enabled: true } });
    expect(view.result.current).toBe(1); expect(frames.size).toBe(0);
    state.currentTime = 2; view.rerender({ enabled: true }); expect(view.result.current).toBe(2);
    state.getter = () => ({ currentTime: 20, playbackRate: 1, advancing: false });
    view.rerender({ enabled: true }); expect(view.result.current).toBe(20); expect(frames.size).toBe(1);
    view.rerender({ enabled: false }); expect(view.result.current).toBe(2); expect(frames.size).toBe(0);
    state.currentTime = 3; view.rerender({ enabled: false }); expect(view.result.current).toBe(3);
    state.getter = () => ({ currentTime: 50, playbackRate: 1, advancing: false });
    view.rerender({ enabled: true }); expect(view.result.current).toBe(50);
  });
});
