import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan);
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex).map((item, offset) => ({ item, index: startIndex + offset })),
    [endIndex, items, startIndex],
  );

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
    setScrollTop(target.scrollTop);
    if (onEndReached && target.scrollHeight - target.scrollTop - target.clientHeight <= endReachedThreshold) {
      onEndReached();
    }
  };

  return (
    <div ref={rootRef} className={`virtual-list ${className}`.trim()} style={{ height: viewportHeight }} onScroll={handleScroll} role="list" aria-setsize={items.length}>
      <div className="virtual-spacer" style={{ height: contentHeight }}>
        {visibleItems.map(({ item, index }) => (
          <div
            key={getKey(item, index)}
            role="listitem"
            aria-setsize={items.length}
            aria-posinset={index + 1}
            style={{
              position: 'absolute',
              top: index * itemHeight,
              left: 0,
              right: 0,
              height: itemHeight,
            }}
          >
            {renderItem(item, index, { width: '100%', height: '100%' })}
          </div>
        ))}
      </div>
    </div>
  );
}
