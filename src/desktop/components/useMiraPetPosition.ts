import { useCallback, useEffect, useRef, useState,
  type KeyboardEvent, type PointerEvent } from 'react';
import type { MiraActionName } from './miraPetAtlas';

export interface MiraPosition { x: number; y: number }
interface MiraDragState {
  pointerId: number; offsetX: number; offsetY: number;
  width: number; height: number; lastClientX: number;
  directionAction: MiraActionName | null;
}

const STORAGE_KEY = 'tunefree_desktop_mira_position_v3';
const DEFAULT_LEFT = 68;
const DEFAULT_BOTTOM = 72;
const VIEWPORT_MARGIN = 8;
const DEFAULT_WIDTH = 92;
const DEFAULT_HEIGHT = 104;
const DIRECTION_THRESHOLD = 3;
const DIRECTION_HOLD_MS = 700;
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
    return typeof parsed.x === 'number' && typeof parsed.y === 'number'
      ? { x: parsed.x, y: parsed.y } : null;
  } catch { return null; }
};
const savePosition = (position: MiraPosition): void => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(position)); } catch { return; }
};

export const useReducedMotion = (): boolean => {
  const [reducedMotion, setReducedMotion] = useState(false);
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
  const [movementAction, setMovementAction] = useState<MiraActionName | null>(null);

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
  const applyMovementAction = useCallback((nextAction: MiraActionName | null, hold = false) => {
    clearMovementReset();
    setMovementAction(nextAction);
    if (hold && nextAction) {
      movementResetRef.current = window.setTimeout(() => {
        setMovementAction(null);
        movementResetRef.current = null;
      }, DIRECTION_HOLD_MS);
    }
  }, [clearMovementReset]);
  const resetPosition = useCallback(() => {
    const { width, height } = getPetSize();
    const next = defaultPosition(width, height);
    setPosition(next); savePosition(next);
  }, [getPetSize]);
  const interact = useCallback((actionName: MiraActionName) => {
    applyMovementAction(actionName === 'waving' ? 'jumping' : 'waving', true);
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
      offsetY: event.clientY - rect.top, width, height, lastClientX: event.clientX,
      directionAction: null };
    clearMovementReset();
    setPosition(clampPosition({ x: rect.left, y: rect.top }, width, height));
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, [clearMovementReset]);
  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.lastClientX;
    if (Math.abs(deltaX) >= DIRECTION_THRESHOLD) {
      const nextAction: MiraActionName = deltaX > 0 ? 'running_right' : 'running_left';
      drag.directionAction = nextAction; applyMovementAction(nextAction);
    }
    drag.lastClientX = event.clientX;
    setPosition(clampPosition({ x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY }, drag.width, drag.height));
    event.preventDefault();
  }, [applyMovementAction]);
  const finishDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampPosition({ x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY }, drag.width, drag.height);
    setPosition(next); savePosition(next); setDragging(false);
    applyMovementAction(drag.directionAction, !!drag.directionAction);
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [applyMovementAction]);
  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>, actionName: MiraActionName) => {
    const step = event.shiftKey ? 32 : 12;
    if (event.key === 'ArrowLeft') { applyMovementAction('running_left', true); nudgePosition(-step, 0); }
    else if (event.key === 'ArrowRight') { applyMovementAction('running_right', true); nudgePosition(step, 0); }
    else if (event.key === 'ArrowUp') nudgePosition(0, -step);
    else if (event.key === 'ArrowDown') nudgePosition(0, step);
    else if (event.key === 'Home') resetPosition();
    else if (event.key === 'Enter' || event.key === ' ') interact(actionName);
    else return;
    event.preventDefault();
  }, [applyMovementAction, interact, nudgePosition, resetPosition]);

  return { petRef, position, dragging, movementAction, applyMovementAction,
    handlePointerDown, handlePointerMove, finishDrag, handleKeyDown };
};
