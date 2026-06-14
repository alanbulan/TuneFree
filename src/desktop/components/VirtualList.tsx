import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

interface VirtualListProps<T> {
  items: T[];
  itemHeight: number;
  maxHeight?: number;
  fillParent?: boolean;
  overscan?: number;
  className?: string;
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
    setScrollTop(event.currentTarget.scrollTop);
  };

  return (
    <div ref={rootRef} className={`virtual-list ${className}`.trim()} style={{ height: viewportHeight }} onScroll={handleScroll}>
      <div className="virtual-spacer" style={{ height: contentHeight }}>
        {visibleItems.map(({ item, index }) => (
          <Fragment key={getKey(item, index)}>
            {renderItem(item, index, {
              position: 'absolute',
              top: index * itemHeight,
              left: 0,
              right: 0,
              height: itemHeight,
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
