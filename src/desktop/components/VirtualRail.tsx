import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeVirtualWindow, isSameVirtualWindow } from './virtualWindow';

interface VirtualRailProps<T> {
  items: T[];
  itemWidth: number;
  itemHeight: number;
  gap?: number;
  overscan?: number;
  className?: string;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
}

/** 卡片内容始终撑满轨道格子，提出常量避免每次渲染都造一个新对象。 */
const FILL_STYLE: CSSProperties = { width: '100%', height: '100%' };

export default function VirtualRail<T>({
  items,
  itemWidth,
  itemHeight,
  gap = 16,
  overscan = 4,
  className = '',
  getKey,
  renderItem,
}: VirtualRailProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(900);
  const stride = itemWidth + gap;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const updateWidth = () => setViewportWidth(node.clientWidth || 900);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { start: startIndex, end: endIndex } =
    computeVirtualWindow(scrollLeft, viewportWidth, stride, items.length, overscan);
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex).map((item, offset) => ({ item, index: startIndex + offset })),
    [endIndex, items, startIndex],
  );

  // 已渲染出去的窗口，横向滚动时用它判断这一帧是否真的换了卡片，避免 60Hz 空转 setState。
  const renderedWindowRef = useRef({ start: startIndex, end: endIndex });
  useEffect(() => {
    renderedWindowRef.current = { start: startIndex, end: endIndex };
  });

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const nextWindow =
      computeVirtualWindow(event.currentTarget.scrollLeft, viewportWidth, stride, items.length, overscan);
    if (isSameVirtualWindow(nextWindow, renderedWindowRef.current)) return;
    renderedWindowRef.current = nextWindow;
    setScrollLeft(event.currentTarget.scrollLeft);
  };

  return (
    <div ref={ref} className={`virtual-rail ${className}`.trim()} style={{ height: itemHeight + 38 }} onScroll={handleScroll} role="list">
      {/* 撑宽滚动区的垫片不能挡在 list 与 listitem 之间，否则辅助技术看不到列表关系。 */}
      <div className="virtual-rail-spacer" role="presentation" style={{ width: Math.max(0, items.length * stride - gap), height: itemHeight }}>
        {visibleItems.map(({ item, index }) => (
          <div
            key={getKey(item, index)}
            className="virtual-rail-item"
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={index + 1}
            style={{ left: index * stride, width: itemWidth, height: itemHeight }}
          >
            {renderItem(item, index, FILL_STYLE)}
          </div>
        ))}
      </div>
    </div>
  );
}
