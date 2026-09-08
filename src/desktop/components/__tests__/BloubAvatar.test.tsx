import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BloubAvatar from '../BloubAvatar';
import { BotEngine } from '../../../../vendor/bloub/src/bot/engine';
import { EXPRESSIONS } from '../../../../vendor/bloub/src/bot/expressions';
import { SHAPES } from '../../../../vendor/bloub/src/bot/skins';
import { STATES } from '../../../../vendor/bloub/src/bot/states';

const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const step = (time: number) => act(() => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(time));
});
const body = (container: HTMLElement) => container.querySelector('mask > path')!.getAttribute('d');

beforeEach(() => {
  frames.clear(); nextFrame = 0;
  document.documentElement.className = '';
  document.documentElement.style.setProperty('--ios-bg', '#f6f6f8');
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    const id = ++nextFrame; frames.set(id, callback); return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Bloub 官方帧的 React 适配', () => {
  it.each(STATES)('完整绘制 $id 状态的身体、装饰和遮罩', ({ id }) => {
    const { container } = render(<BloubAvatar state={id} frozen />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBe('-158 -158 316 316');
    expect(body(container)).toMatch(/^M/);
    expect(svg.outerHTML).not.toMatch(/NaN|Infinity|undefined/);
    for (const gradient of svg.querySelectorAll('linearGradient')) {
      expect(svg.querySelectorAll(`[stroke="url(#${gradient.id})"]`)).toHaveLength(2);
      expect(gradient.querySelectorAll('stop').length).toBeGreaterThan(1);
    }
    expect(frames.size).toBe(0);
  });

  it('16 种表情生成各不相同的眼睛，8 种外形生成各不相同的轮廓', () => {
    const eyes = new Set<string>();
    for (const { id } of EXPRESSIONS) {
      const view = render(<BloubAvatar state="idle" expression={id} frozen />);
      eyes.add([...view.container.querySelectorAll('mask path')].slice(1).map((path) => path.outerHTML).join(''));
      view.unmount();
    }
    expect(eyes.size).toBe(16);
    const bodies = new Set<string | null>();
    for (const { id } of SHAPES) {
      const view = render(<BloubAvatar state="idle" shape={id} frozen />);
      bodies.add(body(view.container)); view.unmount();
    }
    expect(bodies.size).toBe(8);
  });

  it('状态、表情和外形变化复用引擎，暂停与恢复时正确释放帧循环', () => {
    const sample = vi.spyOn(BotEngine.prototype, 'sample');
    const view = render(<BloubAvatar state="idle" frozen={false} />);
    step(10); step(26);
    const engine = sample.mock.contexts[0];
    view.rerender(<BloubAvatar state="notify" expression="excite" shape="nuage" frozen />);
    expect(sample.mock.contexts.every((value) => value === engine)).toBe(true);
    expect(frames.size).toBe(0);
    expect(view.container.querySelector('mask circle')).not.toBeNull();
    view.rerender(<BloubAvatar state="swirl" frozen={false} />);
    step(30); step(1000);
    const times = sample.mock.calls.map(([time]) => time);
    const [previous, current] = times.slice(-2);
    expect(current - previous).toBeCloseTo(0.064);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  });

  it('跟随鼠标但忽略触摸，离开/切换无脸动画时释放注视', () => {
    const look = vi.spyOn(BotEngine.prototype, 'setLook');
    const view = render(<BloubAvatar state="idle" frozen={false} />);
    const svg = view.container.querySelector('svg')!;
    step(10); // 零尺寸窗口不会向引擎写入无效坐标。
    expect(look).not.toHaveBeenCalled();
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 20, y: 20, left: 20, top: 20,
      width: 112, height: 112, right: 132, bottom: 132, toJSON: () => ({}) });
    fireEvent.pointerMove(window, { pointerType: 'touch', clientX: 200, clientY: 100 });
    step(26);
    fireEvent.pointerMove(window, { pointerType: 'mouse', clientX: 200, clientY: 100 });
    step(42);
    expect(look).toHaveBeenCalled();
    expect(JSON.stringify(look.mock.calls)).not.toContain('NaN');
    fireEvent.pointerLeave(document); step(58);
    view.rerender(<BloubAvatar state="orbit" frozen={false} />); step(74);
    expect(look.mock.calls.some(([target]) => target === null)).toBe(true);
    view.rerender(<BloubAvatar state="idle" frozen={false} followPointer={false} />);
    look.mockClear(); step(90);
    expect(look).not.toHaveBeenCalled();
  });

  it('深浅主题同步官方配色，多个实例的 SVG 标识互不冲突', async () => {
    const view = render(<><BloubAvatar state="orbit" frozen /><BloubAvatar state="orbit" frozen /></>);
    const ids = [...view.container.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    await act(async () => { document.documentElement.classList.add('dark-theme'); });
    expect([...view.container.querySelectorAll('rect')].every((rect) => rect.getAttribute('fill') === '#f1efe9')).toBe(true);
    await act(async () => { document.documentElement.style.removeProperty('--ios-bg'); });
    expect(view.container.innerHTML).toContain('#f6f6f8');
  });
});
