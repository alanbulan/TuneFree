import type { CSSProperties, ReactNode, UIEvent } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

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

  const startIndex = Math.max(0, Math.floor(scrollLeft / stride) - overscan);
  const endIndex = Math.min(items.length, Math.ceil((scrollLeft + viewportWidth) / stride) + overscan);
  const visibleItems = useMemo(
    () => items.slice(startIndex, endIndex).map((item, offset) => ({ item, index: startIndex + offset })),
    [endIndex, items, startIndex],
  );

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    setScrollLeft(event.currentTarget.scrollLeft);
  };

  return (
    <div ref={ref} className={`virtual-rail ${className}`.trim()} style={{ height: itemHeight + 38 }} onScroll={handleScroll}>
      <div className="virtual-rail-spacer" style={{ width: Math.max(0, items.length * stride - gap), height: itemHeight }}>
        {visibleItems.map(({ item, index }) => (
          <Fragment key={getKey(item, index)}>
            {renderItem(item, index, {
              position: 'absolute',
              top: 8,
              left: index * stride,
              width: itemWidth,
              height: itemHeight,
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
