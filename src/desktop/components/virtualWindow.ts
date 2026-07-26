/** Index range of the items a virtualised container currently has to render. */
export interface VirtualWindow {
  start: number;
  end: number;
}

/**
 * Compute the visible index window (overscan included) for a virtualised list.
 *
 * `offset` / `viewportSize` / `itemSize` are along the scroll axis, so the same
 * function serves both the vertical list and the horizontal rail.
 */
export const computeVirtualWindow = (
  offset: number,
  viewportSize: number,
  itemSize: number,
  itemCount: number,
  overscan: number,
): VirtualWindow => {
  const stride = itemSize > 0 ? itemSize : 1;
  const safeOffset = Number.isFinite(offset) && offset > 0 ? offset : 0;
  const safeViewport = Number.isFinite(viewportSize) && viewportSize > 0 ? viewportSize : 0;
  return {
    start: Math.max(0, Math.floor(safeOffset / stride) - overscan),
    end: Math.min(itemCount, Math.ceil((safeOffset + safeViewport) / stride) + overscan),
  };
};

/** Whether two windows select a different slice, i.e. a re-render is required. */
export const isSameVirtualWindow = (a: VirtualWindow, b: VirtualWindow): boolean =>
  a.start === b.start && a.end === b.end;
