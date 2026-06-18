type ResizeDirection = 'East' | 'North' | 'NorthEast' | 'NorthWest' | 'South' | 'SouthEast' | 'SouthWest' | 'West';

const RESIZE_HANDLES: Array<{
  direction: ResizeDirection;
  className: string;
  title: string;
}> = [
  { direction: 'North', className: 'desktop-lyric-resize-n', title: '向上调整歌词边界' },
  { direction: 'South', className: 'desktop-lyric-resize-s', title: '向下调整歌词边界' },
  { direction: 'West', className: 'desktop-lyric-resize-w', title: '向左调整歌词边界' },
  { direction: 'East', className: 'desktop-lyric-resize-e', title: '向右调整歌词边界' },
  { direction: 'NorthWest', className: 'desktop-lyric-resize-nw', title: '调整左上角歌词边界' },
  { direction: 'NorthEast', className: 'desktop-lyric-resize-ne', title: '调整右上角歌词边界' },
  { direction: 'SouthWest', className: 'desktop-lyric-resize-sw', title: '调整左下角歌词边界' },
  { direction: 'SouthEast', className: 'desktop-lyric-resize-se', title: '调整右下角歌词边界' },
];

interface DesktopLyricResizeHandlesProps {
  disabled?: boolean;
}

export function DesktopLyricResizeHandles({ disabled = false }: DesktopLyricResizeHandlesProps) {
  if (disabled) return null;

  const startResize = async (direction: ResizeDirection) => {
    if (typeof window === 'undefined' || !(window as any).__TAURI_INTERNALS__) return;

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().startResizeDragging(direction);
    } catch (e) {
      console.warn('Failed to start desktop lyric resize:', e);
    }
  };

  return (
    <div className="desktop-lyric-resize-layer" aria-hidden="true">
      {RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.direction}
          type="button"
          className={`desktop-lyric-resize-handle ${handle.className}`}
          title={handle.title}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void startResize(handle.direction);
          }}
        />
      ))}
    </div>
  );
}
