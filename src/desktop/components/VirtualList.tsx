import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { computeVirtualWindow, isSameVirtualWindow } from './virtualWindow';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  maxHeight?: number;
  fillParent?: boolean;
  overscan?: number;
  className?: string;
  onEndReached?: () => void;
  endReachedThreshold?: number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
}

/** 行内容始终撑满行容器，提出常量避免每次渲染都造一个新对象。 */
const FILL_STYLE: CSSProperties = { width: '100%', height: '100%' };

export default function VirtualList<T>({
  items,
  itemHeight,
  maxHeight = 620,
  fillParent = false,
  overscan = 6,
  className = '',
  onEndReached,
  endReachedThreshold = 96,
  getKey,
  renderItem,
}: VirtualListProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [parentHeight, setParentHeight] = useState(0);
  const contentHeight = items.length * itemHeight;
  const fallbackHeight = Math.min(contentHeight, maxHeight);
  const viewportHeight = fillParent && parentHeight > 0 ? Math.min(contentHeight, parentHeight) : fallbackHeight;
  const { start: startIndex, end: endIndex } =
    computeVirtualWindow(scrollTop, viewportHeight, itemHeight, items.length, overscan);
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex).map((item, offset) => ({ item, index: startIndex + offset })),
    [endIndex, items, startIndex],
  );

  // 已渲染出去的窗口，滚动时用它判断这一帧是否真的换了行，避免 60Hz 空转 setState。
  const renderedWindowRef = useRef({ start: startIndex, end: endIndex });
  useEffect(() => {
    renderedWindowRef.current = { start: startIndex, end: endIndex };
  });

  useEffect(() => {
    if (!fillParent) return;
    const parent = rootRef.current?.parentElement;
    if (!parent) return;

    const updateParentHeight = () => setParentHeight(parent.clientHeight);
    updateParentHeight();

    const observer = new ResizeObserver(updateParentHeight);
    observer.observe(parent);
    window.addEventListener('resize', updateParentHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateParentHeight);
    };
  }, [fillParent]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const nextWindow =
      computeVirtualWindow(target.scrollTop, viewportHeight, itemHeight, items.length, overscan);
    if (!isSameVirtualWindow(nextWindow, renderedWindowRef.current)) {
      renderedWindowRef.current = nextWindow;
      setScrollTop(target.scrollTop);
    }
    if (onEndReached && target.scrollHeight - target.scrollTop - target.clientHeight <= endReachedThreshold) {
      onEndReached();
    }
  };

  return (
    <div ref={rootRef} className={`virtual-list ${className}`.trim()} style={{ height: viewportHeight }} onScroll={handleScroll} role="list">
      {/* 撑高滚动区的垫片不能挡在 list 与 listitem 之间，否则辅助技术看不到列表关系。 */}
      <div className="virtual-spacer" role="presentation" style={{ height: contentHeight }}>
        {visibleItems.map(({ item, index }) => (
          <div
            key={getKey(item, index)}
            className="virtual-list-row"
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={index + 1}
            style={{ top: index * itemHeight, height: itemHeight }}
          >
            {renderItem(item, index, FILL_STYLE)}
          </div>
        ))}
      </div>
    </div>
  );
}
