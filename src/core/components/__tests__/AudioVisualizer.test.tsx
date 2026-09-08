import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioVisualizer from '../AudioVisualizer';
import { BAR_COUNT, renderVisualizerBar } from '../audioVisualizerCore';

const mocks = vi.hoisted(() => ({ analyser: null as AnalyserNode | null, legacy: false }));
vi.mock('../../contexts/PlayerContext', () => ({ usePlayerAnalyser: () => ({ analyser: mocks.analyser }) }));
vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return { ...react, useRef: <T,>(initial: T) => {
    const ref = react.useRef(initial);
    if (mocks.legacy && initial && typeof initial === 'object' && 'displayValues' in initial) {
      // 模拟 Fast Refresh 保留的旧版状态，验证已有迁移逻辑能恢复可用频谱。
      mocks.legacy = false;
      Object.assign(ref.current!, { displayValues: [], simValues: undefined, simTargets: [] });
    }
    return ref;
  } };
});
const frames = new Map<number, FrameRequestCallback>(); let id = 0;
let resize: (() => void) | undefined, theme: (() => void) | undefined;
const disconnect = vi.fn(); let width = 440, height = 100;
const context = { clearRect: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(), roundRect: vi.fn(), fill: vi.fn(),
  moveTo: vi.fn(), arcTo: vi.fn(), lineTo: vi.fn(), fillStyle: '' };
const step = (count = 1) => { for (let index = 0; index < count; index++) {
  const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(index * 16));
} };
beforeEach(() => {
  vi.clearAllMocks(); mocks.analyser = null; mocks.legacy = false; frames.clear(); id = 0; width = 440; height = 100;
  resize = undefined; theme = undefined; context.fillStyle = '';
  vi.stubGlobal('devicePixelRatio', 2);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }));
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((key: number) => frames.delete(key)));
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect = disconnect; });
  vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { theme = callback; } observe() {} disconnect = disconnect; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('音频频谱帧循环', () => {
  it('按像素密度绘制，暂停衰减后停止帧，尺寸和主题变化只重画必要帧', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); vi.spyOn(Math, 'sin').mockReturnValue(0);
    const view = render(<AudioVisualizer isPlaying />); const canvas = view.container.querySelector('canvas')!;
    expect(canvas.width).toBe(880); expect(canvas.height).toBe(200); expect(context.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    expect(context.roundRect).toHaveBeenCalledTimes(BAR_COUNT); act(() => step(3));
    expect(frames.size).toBe(1);
    view.rerender(<AudioVisualizer isPlaying={false} />); act(() => step(100)); expect(frames.size).toBe(0);
    const draws = context.clearRect.mock.calls.length; width = 220; act(() => resize?.());
    expect(canvas.width).toBe(440); expect(context.clearRect.mock.calls.length).toBeGreaterThan(draws);
    canvas.style.setProperty('--visualizer-bar-rgb', '255, 30, 60'); act(() => theme?.());
    expect(context.fillStyle).toContain('255, 30, 60'); expect(frames.size).toBe(0);
    act(() => window.dispatchEvent(new Event('resize')));
    view.unmount(); expect(disconnect).toHaveBeenCalled();
  });

  it('真实频率数据覆盖整个频谱，振幅下降平滑且没有无效几何', () => {
    let amplitude = 255;
    const read = vi.fn((bytes: Uint8Array) => bytes.fill(amplitude));
    mocks.analyser = { frequencyBinCount: 256, getByteFrequencyData: read } as unknown as AnalyserNode;
    const view = render(<AudioVisualizer isPlaying />); const first = context.roundRect.mock.calls[0][3];
    amplitude = 0; act(() => step()); const next = context.roundRect.mock.calls[BAR_COUNT][3];
    expect(read).toHaveBeenCalledTimes(2); expect(next).toBeLessThan(first); expect(next).toBeGreaterThan(4);
    expect(context.roundRect.mock.calls.every((args) => args.every(Number.isFinite))).toBe(true);
    view.rerender(<AudioVisualizer isPlaying suspended />); expect(frames.size).toBe(0);
    expect(context.clearRect).toHaveBeenLastCalledWith(0, 0, 440, 100);
  });

  it('兼容旧热更新状态、空频谱和不支持观察器的环境', () => {
    mocks.legacy = true; mocks.analyser = { frequencyBinCount: 0, getByteFrequencyData: vi.fn() } as unknown as AnalyserNode;
    vi.stubGlobal('ResizeObserver', undefined); vi.stubGlobal('MutationObserver', undefined); vi.stubGlobal('devicePixelRatio', 0);
    render(<AudioVisualizer isPlaying />); act(() => step());
    expect(context.roundRect.mock.calls.every((args) => args.every(Number.isFinite))).toBe(true);
    expect(context.setTransform).toHaveBeenCalledWith(1, 0, 0, 1, 0, 0);
  });

  it('缺少 Canvas 上下文时不启动动画，旧 Canvas API 使用路径圆角', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    render(<AudioVisualizer isPlaying />); expect(frames.size).toBe(0);
    const legacy = { ...context, roundRect: undefined } as unknown as CanvasRenderingContext2D;
    renderVisualizerBar(legacy, 1, 0, 100, 2, '1, 2, 3');
    expect(context.arcTo).toHaveBeenCalledTimes(4); expect(context.fill).toHaveBeenCalledOnce();
  });
});
