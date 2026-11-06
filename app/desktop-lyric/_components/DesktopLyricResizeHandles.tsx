import type { ResizeDirection } from '../_core/resizeGeometry';
import { useLyricWindowResize } from '../_core/useLyricWindowResize';

const RESIZE_HANDLES: Array<{ direction: ResizeDirection; className: string; title: string }> = [
  { direction: 'North', className: 'desktop-lyric-resize-n', title: '向上调整歌词边界' },
  { direction: 'South', className: 'desktop-lyric-resize-s', title: '向下调整歌词边界' },
  { direction: 'West', className: 'desktop-lyric-resize-w', title: '向左调整歌词边界' },
  { direction: 'East', className: 'desktop-lyric-resize-e', title: '向右调整歌词边界' },
  { direction: 'NorthWest', className: 'desktop-lyric-resize-nw', title: '调整左上角歌词边界' },
  { direction: 'NorthEast', className: 'desktop-lyric-resize-ne', title: '调整右上角歌词边界' },
  { direction: 'SouthWest', className: 'desktop-lyric-resize-sw', title: '调整左下角歌词边界' },
  { direction: 'SouthEast', className: 'desktop-lyric-resize-se', title: '调整右下角歌词边界' },
];

export function DesktopLyricResizeHandles({ disabled = false }: { disabled?: boolean }) {
  const { resizing, beginResize, updateResize, endResize } = useLyricWindowResize(disabled);
  if (disabled) return null;
  return (
    <div className="desktop-lyric-resize-layer" aria-hidden="true" data-resizing={resizing}>
      {RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.direction}
          type="button"
          className={`desktop-lyric-resize-handle ${handle.className}`}
          aria-label={handle.title}
          tabIndex={-1}
          onPointerDown={(event) => void beginResize(event, handle.direction)}
          onPointerMove={updateResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          onLostPointerCapture={endResize}
        />
      ))}
    </div>
  );
}
