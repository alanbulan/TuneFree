import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { getCurrentWindow, invokeCommand, isTauri, PhysicalPosition, PhysicalSize } from '../../../src/core/ipc';
import { resizeLyricBounds, type LyricWindowBounds, type ResizeDirection } from './resizeGeometry';

interface ResizeSession {
  pointerId: number;
  direction: ResizeDirection;
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  scale: number;
  bounds: LyricWindowBounds | null;
  target: LyricWindowBounds | null;
  writing: boolean;
  cancelled: boolean;
  finished: boolean;
}

/** tao's drag_resize_window is unsupported on macOS; pointer capture keeps all eight edges usable. */
export const useLyricWindowResize = (disabled: boolean) => {
  const [resizing, setResizing] = useState(false);
  const sessionRef = useRef<ResizeSession | null>(null);
  if (disabled && resizing) setResizing(false);

  useEffect(() => {
    if (disabled && sessionRef.current) sessionRef.current.cancelled = true;
    return () => {
      if (sessionRef.current) sessionRef.current.cancelled = true;
      sessionRef.current = null;
    };
  }, [disabled]);

  const flushBounds = async (session: ResizeSession) => {
    if (session.writing) return;
    session.writing = true;
    try {
      const window = getCurrentWindow();
      // Coalesce move events: one native write at a time, followed only by the latest bounds.
      while (session.target && !session.cancelled) {
        const next = session.target;
        session.target = null;
        await window.setSize(new PhysicalSize(next.width, next.height));
        if (!session.cancelled && (session.direction.includes('West') || session.direction.includes('North'))) {
          await window.setPosition(new PhysicalPosition(next.x, next.y));
        }
      }
    } catch (error) {
      session.cancelled = true;
      if (sessionRef.current === session) setResizing(false);
      console.warn('Failed to resize desktop lyrics:', error);
    } finally {
      session.writing = false;
    }
  };

  const queueBounds = (session: ResizeSession) => {
    if (!session.bounds || session.cancelled) return;
    session.target = resizeLyricBounds(session.bounds, session.direction,
      (session.latestX - session.startX) * session.scale, (session.latestY - session.startY) * session.scale, session.scale);
    void flushBounds(session);
  };

  const beginResize = async (event: PointerEvent<HTMLButtonElement>, direction: ResizeDirection) => {
    if (event.button !== 0 || disabled || !isTauri()) return;
    event.preventDefault();
    event.stopPropagation();
    const { pointerId, screenX, screenY } = event;
    event.currentTarget.setPointerCapture(pointerId);
    if (sessionRef.current) sessionRef.current.cancelled = true;
    const session: ResizeSession = {
      pointerId, direction, startX: screenX, startY: screenY, latestX: screenX, latestY: screenY,
      scale: 1, bounds: null, target: null, writing: false, cancelled: false, finished: false,
    };
    sessionRef.current = session;
    setResizing(true);
    try {
      const window = getCurrentWindow();
      const { os } = await invokeCommand('get_runtime_info');
      if (session.cancelled) return;
      if (os !== 'macos') {
        if (!session.finished) await window.startResizeDragging(direction);
        if (sessionRef.current === session) setResizing(false);
        return;
      }
      const [position, size, scale] = await Promise.all([window.outerPosition(), window.outerSize(), window.scaleFactor()]);
      if (session.cancelled) return;
      session.scale = scale;
      session.bounds = { x: position.x, y: position.y, width: size.width, height: size.height };
      // A quick drag can finish while IPC is initializing. Apply its final position as well.
      if (session.latestX !== session.startX || session.latestY !== session.startY) queueBounds(session);
    } catch (error) {
      console.warn('Failed to start desktop lyric resize:', error);
      if (sessionRef.current === session) setResizing(false);
    }
  };

  const updateResize = (event: PointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.finished || session.pointerId !== event.pointerId) return;
    session.latestX = event.screenX;
    session.latestY = event.screenY;
    queueBounds(session);
  };

  const endResize = (event: PointerEvent<HTMLButtonElement>) => {
    const session = sessionRef.current;
    if (!session || session.finished || session.pointerId !== event.pointerId) return;
    if (event.type === 'pointerup') updateResize(event);
    else session.cancelled = true;
    session.finished = true;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return { resizing: resizing && !disabled, beginResize, updateResize, endResize };
};
