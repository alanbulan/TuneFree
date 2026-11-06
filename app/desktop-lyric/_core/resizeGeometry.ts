export type ResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

export interface LyricWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screen deltas and bounds are physical pixels, including on Retina monitors. */
export const resizeLyricBounds = (
  initial: LyricWindowBounds,
  direction: ResizeDirection,
  dx: number,
  dy: number,
  scale: number,
): LyricWindowBounds => {
  const west = direction.includes('West');
  const north = direction.includes('North');
  const horizontal = west || direction.includes('East');
  const vertical = north || direction.includes('South');
  const width = horizontal ? Math.max(400 * scale, initial.width + (west ? -dx : dx)) : initial.width;
  const height = vertical ? Math.max(200 * scale, initial.height + (north ? -dy : dy)) : initial.height;
  return {
    x: Math.round(west ? initial.x + initial.width - width : initial.x),
    y: Math.round(north ? initial.y + initial.height - height : initial.y),
    width: Math.round(width),
    height: Math.round(height),
  };
};
