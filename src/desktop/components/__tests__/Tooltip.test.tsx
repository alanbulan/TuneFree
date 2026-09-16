import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tooltip from '../Tooltip';

/**
 * jsdom/happy-dom 里元素没有真实布局，`getBoundingClientRect` 恒为 0，
 * 而组件对零尺寸锚点是「量不到就不显示」。所以这里给锚点补上尺寸，
 * 才能验证定位与翻转逻辑。
 */
const stubRect = (rect: Partial<DOMRect>) => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    x: 0, y: 0, toJSON: () => ({}), ...rect,
  } as DOMRect);
};

const renderTooltip = (label = '提示文本', side?: 'top' | 'bottom') =>
  render(
    <Tooltip label={label} side={side}>
      <button type="button">目标</button>
    </Tooltip>,
  );

const hover = (name = '目标') => fireEvent.mouseEnter(screen.getByRole('button', { name }));
const unhover = (name = '目标') => fireEvent.mouseLeave(screen.getByRole('button', { name }));
const advance = async (ms: number) => { await act(() => vi.advanceTimersByTimeAsync(ms)); };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Tooltip', () => {
  it('悬停要等延迟才出现，提前移开就不出现', async () => {
    stubRect({ top: 400, left: 200, bottom: 430, width: 60, height: 30 });
    renderTooltip();

    hover();
    await advance(200);
    expect(screen.queryByRole('tooltip')).toBeNull();

    await advance(200);
    expect(screen.getByRole('tooltip').textContent).toBe('提示文本');

    unhover();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('移开后立即收起，不会残留', async () => {
    stubRect({ top: 400, left: 200, bottom: 430, width: 60, height: 30 });
    renderTooltip();
    hover();
    await advance(400);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    unhover();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('默认在上方，顶部空间不足时翻到下方', async () => {
    stubRect({ top: 400, left: 200, bottom: 430, width: 60, height: 30 });
    renderTooltip();
    hover(); await advance(400);
    expect(screen.getByRole('tooltip').className).toContain('is-top');
    cleanup();

    // 贴近视口顶部：上方放不下
    stubRect({ top: 4, left: 200, bottom: 34, width: 60, height: 30 });
    renderTooltip();
    hover(); await advance(400);
    expect(screen.getByRole('tooltip').className).toContain('is-bottom');
  });

  it('键盘聚焦同样触发，Esc 与按下鼠标都会收起', async () => {
    stubRect({ top: 400, left: 200, bottom: 430, width: 60, height: 30 });
    renderTooltip();
    const button = screen.getByRole('button', { name: '目标' });

    fireEvent.focus(button);
    await advance(400);
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.keyDown(button, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    await advance(400);
    fireEvent.pointerDown(button);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('把 aria-describedby 挂到子元素上，且只在显示时存在', async () => {
    stubRect({ top: 400, left: 200, bottom: 430, width: 60, height: 30 });
    renderTooltip();
    const button = screen.getByRole('button', { name: '目标' });
    expect(button.getAttribute('aria-describedby')).toBeNull();

    hover(); await advance(400);
    const tooltip = screen.getByRole('tooltip');
    expect(button.getAttribute('aria-describedby')).toBe(tooltip.id);
  });

  it('多行文案左对齐排版', async () => {
    stubRect({ top: 400, left: 200, bottom: 430, width: 60, height: 30 });
    renderTooltip('第一行\n第二行');
    hover(); await advance(400);
    expect(screen.getByRole('tooltip').className).toContain('is-multiline');
  });

  it('量不到锚点尺寸时宁可不显示，也不显示在错误位置', async () => {
    stubRect({ top: 0, left: 0, bottom: 0, width: 0, height: 0 });
    renderTooltip();
    hover(); await advance(400);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
