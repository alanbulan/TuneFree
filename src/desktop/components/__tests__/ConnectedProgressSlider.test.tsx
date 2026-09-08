// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectedProgressSlider from '../ConnectedProgressSlider';

interface ProgressSnapshot {
  currentTime: number;
  duration: number;
  lyricOffsetSeconds: number;
}

const store = vi.hoisted(() => {
  let snapshot: ProgressSnapshot = { currentTime: 0, duration: 240, lyricOffsetSeconds: 0 };
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    set: (next: ProgressSnapshot) => {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
    reset: () => {
      snapshot = { currentTime: 0, duration: 240, lyricOffsetSeconds: 0 };
    },
  };
});

it('拖动先预览，松开才提交，取消和失焦恢复真实进度', () => {
  seek.mockClear(); store.reset(); render(<ConnectedProgressSlider />);
  fireEvent.pointerDown(slider(), { pointerId: 1 }); fireEvent.input(slider(), { target: { value: '42' } });
  expect(slider().value).toBe('42'); expect(seek).not.toHaveBeenCalled(); fireEvent.pointerUp(slider(), { pointerId: 1 }); expect(seek).toHaveBeenCalledWith(42);
  fireEvent.input(slider(), { target: { value: '70' } }); fireEvent.pointerCancel(slider()); expect(slider().value).toBe('0');
  fireEvent.input(slider(), { target: { value: '80' } }); fireEvent.blur(slider()); expect(slider().value).toBe('0');
});

const seek = vi.hoisted(() => vi.fn());

// 用外部 store 模拟"高频进度订阅"：只有真正调用该 hook 的组件才会被唤醒。
vi.mock('../../../core/contexts/PlayerContext', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePlayerProgress: () => useSyncExternalStore(store.subscribe, store.getSnapshot),
    usePlayerActions: () => ({ seek }),
  };
});

const parentRenders = vi.fn();

const TransportShell = () => {
  parentRenders();
  return (
    <div>
      <span>传输栏</span>
      <ConnectedProgressSlider />
    </div>
  );
};

const slider = () => screen.getByLabelText('播放进度') as HTMLInputElement;

describe('ConnectedProgressSlider 自订阅', () => {
  beforeEach(() => {
    parentRenders.mockClear();
    seek.mockClear();
    store.reset();
  });

  it('进度推进不会重渲染外层传输栏', () => {
    render(<TransportShell />);
    expect(parentRenders).toHaveBeenCalledTimes(1);
    expect(slider().value).toBe('0');

    for (const currentTime of [1, 2, 3, 4, 5]) {
      act(() => store.set({ currentTime, duration: 240, lyricOffsetSeconds: 0 }));
    }

    expect(parentRenders).toHaveBeenCalledTimes(1);
    expect(slider().value).toBe('5');
    expect(screen.getByText('0:05')).toBeTruthy();
  });

  it('时长变化同步到滑块上限', () => {
    render(<TransportShell />);
    act(() => store.set({ currentTime: 30, duration: 90, lyricOffsetSeconds: 0 }));

    expect(slider().max).toBe('90');
    expect(screen.getByText('1:30')).toBeTruthy();
    expect(parentRenders).toHaveBeenCalledTimes(1);
  });

  it('拖动提交后调用 context 的 seek', () => {
    render(<TransportShell />);
    const input = slider();

    fireEvent.change(input, { target: { value: '120' } });
    fireEvent.keyUp(input, { key: 'End' });

    expect(seek).toHaveBeenCalledWith(120);
    expect(parentRenders).toHaveBeenCalledTimes(1);
  });
});
