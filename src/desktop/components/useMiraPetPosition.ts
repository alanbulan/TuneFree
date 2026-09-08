import { useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent } from 'react';
export type CompanionGesture = 'wink' | 'burst';

export interface MiraPosition { x: number; y: number }
interface MiraDragState {
  pointerId: number; offsetX: number; offsetY: number;
  width: number; height: number;
  startX: number; startY: number; moved: boolean;
}

const STORAGE_KEY = 'tunefree_desktop_mira_position_v3';
const DEFAULT_LEFT = 52;
const DEFAULT_BOTTOM = 120;
const VIEWPORT_MARGIN = 8;
const DEFAULT_WIDTH = 112;
const DEFAULT_HEIGHT = 112;
const DRAG_THRESHOLD = 3;
const GESTURE_HOLD_MS = 1800;
const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));
const clampPosition = (position: MiraPosition, width: number, height: number): MiraPosition => ({
  x: clamp(position.x, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
  y: clamp(position.y, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN),
});
const defaultPosition = (width: number, height: number) => clampPosition({
  x: DEFAULT_LEFT, y: window.innerHeight - height - DEFAULT_BOTTOM,
}, width, height);
const readStoredPosition = (): MiraPosition | null => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<MiraPosition>;
    return typeof parsed.x === 'number' && Number.isFinite(parsed.x)
      && typeof parsed.y === 'number' && Number.isFinite(parsed.y)
      ? { x: parsed.x, y: parsed.y } : null;
  } catch { return null; }
};
const savePosition = (position: MiraPosition): void => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(position)); } catch { return; }
};

export const useReducedMotion = (): boolean => {
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reducedMotion;
};

export const useMiraPetPosition = () => {
  const petRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MiraDragState | null>(null);
  const movementResetRef = useRef<number | null>(null);
  const [position, setPosition] = useState<MiraPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [movementAction, setMovementAction] = useState<CompanionGesture | null>(null);

  const getPetSize = useCallback(() => {
    const rect = petRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width > 0 ? rect.width : DEFAULT_WIDTH,
      height: rect && rect.height > 0 ? rect.height : DEFAULT_HEIGHT,
    };
  }, []);
  const clearMovementReset = useCallback(() => {
    if (movementResetRef.current === null) return;
    window.clearTimeout(movementResetRef.current);
    movementResetRef.current = null;
  }, []);
  const applyMovementAction = useCallback((nextAction: CompanionGesture | null, hold = false) => {
    clearMovementReset();
    setMovementAction(nextAction);
    if (hold && nextAction) {
      movementResetRef.current = window.setTimeout(() => {
        setMovementAction(null);
        movementResetRef.current = null;
      }, GESTURE_HOLD_MS);
    }
  }, [clearMovementReset]);
  const resetPosition = useCallback(() => {
    const { width, height } = getPetSize();
    const next = defaultPosition(width, height);
    setPosition(next); savePosition(next);
  }, [getPetSize]);
  const interact = useCallback((actionName: CompanionGesture | null) => {
    applyMovementAction(actionName === 'wink' ? 'burst' : 'wink', true);
  }, [applyMovementAction]);
  const nudgePosition = useCallback((dx: number, dy: number) => {
    const { width, height } = getPetSize();
    setPosition((current) => {
      const base = current ?? defaultPosition(width, height);
      const next = clampPosition({ x: base.x + dx, y: base.y + dy }, width, height);
      savePosition(next); return next;
    });
  }, [getPetSize]);

  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      const { width, height } = getPetSize();
      const saved = readStoredPosition();
      setPosition(saved ? clampPosition(saved, width, height) : defaultPosition(width, height));
    });
    return () => { window.cancelAnimationFrame(timer); clearMovementReset(); };
  }, [clearMovementReset, getPetSize]);
  useEffect(() => {
    const handleResize = () => {
      const { width, height } = getPetSize();
      setPosition((current) => clampPosition(current ?? defaultPosition(width, height), width, height));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [getPetSize]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = petRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = rect.width || DEFAULT_WIDTH;
    const height = rect.height || DEFAULT_HEIGHT;
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top, width, height,
      startX: event.clientX, startY: event.clientY, moved: false };
    clearMovementReset();
    setPosition(clampPosition({ x: rect.left, y: rect.top }, width, height));
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [clearMovementReset]);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD) return;
    drag.moved = true;
    setDragging(true);
    setPosition(clampPosition({ x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY }, drag.width, drag.height));
    event.preventDefault();
  }, []);
  const finishDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.moved && event.type !== 'pointercancel') {
      const next = clampPosition({ x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY }, drag.width, drag.height);
      setPosition(next); savePosition(next);
    }
    setDragging(false);
    if (!drag.moved && event.type !== 'pointercancel') interact(movementAction);
    else applyMovementAction(null);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [applyMovementAction, interact, movementAction]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 12;
    if (event.key === 'ArrowLeft') nudgePosition(-step, 0);
    else if (event.key === 'ArrowRight') nudgePosition(step, 0);
    else if (event.key === 'ArrowUp') nudgePosition(0, -step);
    else if (event.key === 'ArrowDown') nudgePosition(0, step);
    else if (event.key === 'Home') resetPosition();
    else if (event.key === 'Enter' || event.key === ' ') interact(movementAction);
    else return;
    event.preventDefault();
  }, [interact, movementAction, nudgePosition, resetPosition]);

  return { petRef, position, dragging, movementAction,
    handlePointerDown, handlePointerMove, finishDrag, handleKeyDown };
};
