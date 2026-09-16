import { cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 自绘 tooltip，替代 `title` 属性触发的浏览器原生提示框。
 *
 * 原生 tooltip 的样式完全由系统决定（灰色方框、字体与圆角都跟应用无关），
 * 在深色主题下尤其突兀，延迟也不可控。
 *
 * 三个关键实现选择：
 * - 锚点用 `display: contents` 包裹：它不生成盒子，因此**不参与布局**，
 *   包裹 `song-row` 那种 grid 子元素也不会打乱网格；
 * - 气泡用 portal 挂到 body：`.view-scroll` 有 overflow，留在原地会被裁掉；
 * - 不依赖动效库：桌面歌词窗口是另一个文档、不加载全局样式包，
 *   为了 tooltip 把整套动效库拉进那个窗口不划算，这里用纯 CSS 过渡。
 */

interface TooltipProps {
  /** 提示文案；含换行时自动按多行左对齐排版。 */
  label: string;
  /** 被提示的元素，必须是单个元素（用于挂 aria-describedby）。 */
  children: ReactNode;
  /** 优先展示方向，空间不足时自动翻转。 */
  side?: 'top' | 'bottom';
  className?: string;
}

/** 气泡与锚点之间的间距。 */
const GAP = 8;
/** 悬停多久才出现；太短会在划过按钮时闪个不停。 */
const SHOW_DELAY_MS = 320;
/** 视口边缘留白，用于水平方向收拢。 */
const VIEWPORT_PADDING = 8;
/** 翻转所需的最小可用空间。 */
const MIN_ROOM = 32;

interface Placement {
  left: number;
  top: number;
  side: 'top' | 'bottom';
}

export default function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const [placement, setPlacement] = useState<Placement | null>(null);
  const timerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setPlacement(null);
  }, [clearTimer]);

  /** 量出锚点位置；首选方向放不下就翻到另一侧。 */
  const measure = useCallback((): Placement | null => {
    // display:contents 的包裹层没有盒子，实际尺寸要问它的第一个元素子节点。
    const anchor = anchorRef.current?.firstElementChild as HTMLElement | null;
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    const resolved = side === 'top'
      ? (rect.top - GAP >= MIN_ROOM ? 'top' : 'bottom')
      : (rect.bottom + GAP <= window.innerHeight - MIN_ROOM ? 'bottom' : 'top');
    return {
      left: rect.left + rect.width / 2,
      top: resolved === 'top' ? rect.top - GAP : rect.bottom + GAP,
      side: resolved,
    };
  }, [side]);

  const show = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const next = measure();
      if (next) setPlacement(next);
    }, SHOW_DELAY_MS);
  }, [clearTimer, measure]);

  // 气泡渲染后再量一次宽度，把它收拢进视口（长文案 + 贴边按钮会溢出）。
  useLayoutEffect(() => {
    if (!placement || !bubbleRef.current) return;
    const bubble = bubbleRef.current.getBoundingClientRect();
    const half = bubble.width / 2;
    const min = half + VIEWPORT_PADDING;
    const max = window.innerWidth - half - VIEWPORT_PADDING;
    const clamped = Math.min(Math.max(placement.left, min), Math.max(min, max));
    if (clamped !== placement.left) setPlacement({ ...placement, left: clamped });
  }, [placement]);

  // 滚动或缩放后锚点会移位，继续显示会错位，直接收起。
  useEffect(() => {
    if (!placement) return;
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [placement, hide]);

  useEffect(() => clearTimer, [clearTimer]);

  const anchor = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': placement ? tooltipId : undefined,
      })
    : children;

  return (
    <>
      <span
        ref={anchorRef}
        className="tooltip-anchor"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onPointerDown={hide}
        onKeyDown={(event) => {
          if (event.key === 'Escape') hide();
        }}
      >
        {anchor}
      </span>
      {placement && createPortal(
        <div
          ref={bubbleRef}
          id={tooltipId}
          role="tooltip"
          className={`tooltip-bubble is-${placement.side}${label.includes('\n') ? ' is-multiline' : ''}${className ? ` ${className}` : ''}`}
          style={{ left: placement.left, top: placement.top }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
