import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { usePlayerNowPlaying, usePlayerProgress } from '../../core/contexts/PlayerContext';
import {
  MIRA_ACTION_POOLS,
  MIRA_ACTIONS,
  MIRA_FRAME_HEIGHT,
  MIRA_FRAME_WIDTH,
  MIRA_SHEET_COLUMNS,
  MIRA_SHEET_ROWS,
  MIRA_SPRITESHEET_URL,
  validateMiraActionCoverage,
  type MiraActionName,
  type MiraMood,
} from './miraPetAtlas';

type MiraSpriteStyle = CSSProperties & {
  '--mira-x': string;
  '--mira-y': string;
};

type MiraPosition = {
  x: number;
  y: number;
};

type MiraDragState = {
  pointerId: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
  lastClientX: number;
  directionAction: MiraActionName | null;
};

const MIRA_POSITION_STORAGE_KEY = 'tunefree_desktop_mira_position_v3';
const MIRA_DEFAULT_LEFT = 68;
const MIRA_DEFAULT_BOTTOM = 72;
const MIRA_VIEWPORT_MARGIN = 8;
const MIRA_DEFAULT_WIDTH = 92;
const MIRA_DEFAULT_HEIGHT = 104;
const MIRA_DIRECTION_THRESHOLD = 3;
const MIRA_DIRECTION_HOLD_MS = 700;

const MIRA_STATUS_LABELS: Record<MiraMood, string> = {
  empty: '待命中，拖我换位置',
  loading: '加载中，我在找歌',
  playing: '播放中，跟着节奏动起来',
  paused: '暂停中，陪你休息一下',
  celebrate: '快到结尾啦，准备下一首',
};

const useReducedMotion = () => {
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

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

const clampPosition = (position: MiraPosition, width: number, height: number): MiraPosition => ({
  x: clamp(position.x, MIRA_VIEWPORT_MARGIN, window.innerWidth - width - MIRA_VIEWPORT_MARGIN),
  y: clamp(position.y, MIRA_VIEWPORT_MARGIN, window.innerHeight - height - MIRA_VIEWPORT_MARGIN),
});

const defaultPosition = (width: number, height: number) => clampPosition({
  x: MIRA_DEFAULT_LEFT,
  y: window.innerHeight - height - MIRA_DEFAULT_BOTTOM,
}, width, height);

const readStoredPosition = (): MiraPosition | null => {
  try {
    const saved = localStorage.getItem(MIRA_POSITION_STORAGE_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved) as Partial<MiraPosition>;
    if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
};

const savePosition = (position: MiraPosition) => {
  try {
    localStorage.setItem(MIRA_POSITION_STORAGE_KEY, JSON.stringify(position));
  } catch {
    return;
  }
};

export default function MiraPet() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const updateVisibility = () => {
      setVisible(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    };
    updateVisibility();
    window.addEventListener('tunefree_pet_toggle', updateVisibility);
    return () => window.removeEventListener('tunefree_pet_toggle', updateVisibility);
  }, []);

  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { currentTime, duration } = usePlayerProgress();
  const reducedMotion = useReducedMotion();
  const petRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<MiraDragState | null>(null);
  const movementResetRef = useRef<number | null>(null);
  const validatedRef = useRef(false);
  const [actionIndex, setActionIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const [position, setPosition] = useState<MiraPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const [movementAction, setMovementAction] = useState<MiraActionName | null>(null);

  const progressRatio = duration > 0 ? currentTime / duration : 0;
  const mood: MiraMood = isLoading
    ? 'loading'
    : isPlaying && progressRatio > 0.92
      ? 'celebrate'
      : isPlaying
        ? 'playing'
        : currentSong
          ? 'paused'
          : 'empty';

  const actionPool = useMemo(() => MIRA_ACTION_POOLS[mood], [mood]);
  const actionName = movementAction ?? actionPool[actionIndex % actionPool.length];
  const action = MIRA_ACTIONS[actionName];
  const activeFrameIndex = frameIndex % action.frames.length;
  const activeFrame = action.frames[activeFrameIndex] || action.frames[0];
  const activeFrameDuration = action.frameDurations[activeFrameIndex] ?? action.frameDurations[0];

  const getPetSize = () => {
    const rect = petRef.current?.getBoundingClientRect();
    return {
      width: rect && rect.width > 0 ? rect.width : MIRA_DEFAULT_WIDTH,
      height: rect && rect.height > 0 ? rect.height : MIRA_DEFAULT_HEIGHT,
    };
  };

  const clearMovementReset = () => {
    if (movementResetRef.current === null) return;
    window.clearTimeout(movementResetRef.current);
    movementResetRef.current = null;
  };

  const applyMovementAction = (nextAction: MiraActionName | null, hold = false) => {
    clearMovementReset();
    setMovementAction(nextAction);

    if (hold && nextAction) {
      movementResetRef.current = window.setTimeout(() => {
        setMovementAction(null);
        movementResetRef.current = null;
      }, MIRA_DIRECTION_HOLD_MS);
    }
  };

  const resetPosition = () => {
    const { width, height } = getPetSize();
    const next = defaultPosition(width, height);
    setPosition(next);
    savePosition(next);
  };

  const interact = () => {
    applyMovementAction(actionName === 'waving' ? 'jumping' : 'waving', true);
  };

  const nudgePosition = (dx: number, dy: number) => {
    const { width, height } = getPetSize();
    setPosition((current) => {
      const base = current ?? defaultPosition(width, height);
      const next = clampPosition({ x: base.x + dx, y: base.y + dy }, width, height);
      savePosition(next);
      return next;
    });
  };

  useEffect(() => {
    if (validatedRef.current || process.env.NODE_ENV === 'production') return;
    validatedRef.current = true;
    validateMiraActionCoverage();
  }, []);

  useEffect(() => {
    const timer = window.requestAnimationFrame(() => {
      const { width, height } = getPetSize();
      const saved = readStoredPosition();
      setPosition(saved ? clampPosition(saved, width, height) : defaultPosition(width, height));
    });

    return () => {
      window.cancelAnimationFrame(timer);
      clearMovementReset();
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const { width, height } = getPetSize();
      setPosition((current) => clampPosition(current ?? defaultPosition(width, height), width, height));
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setActionIndex(0);
    setFrameIndex(0);
    applyMovementAction(null);
  }, [mood]);

  useEffect(() => {
    setFrameIndex(0);
  }, [actionName]);

  useEffect(() => {
    if (reducedMotion) {
      const timer = window.setInterval(() => {
        setFrameIndex(0);
        setActionIndex((current) => (current + 1) % actionPool.length);
      }, 5000);
      return () => window.clearInterval(timer);
    }

    const timer = window.setInterval(() => {
      setFrameIndex((current) => {
        const nextFrame = current + 1;
        if (nextFrame < action.frames.length) return nextFrame;
        if (movementAction) return 0;

        setActionIndex((currentAction) => (currentAction + 1) % actionPool.length);
        return 0;
      });
    }, activeFrameDuration);

    return () => window.clearInterval(timer);
  }, [activeFrameDuration, action.frames.length, actionPool.length, movementAction, reducedMotion]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const element = petRef.current;
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const width = rect.width || MIRA_DEFAULT_WIDTH;
    const height = rect.height || MIRA_DEFAULT_HEIGHT;
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width,
      height,
      lastClientX: event.clientX,
      directionAction: null,
    };

    clearMovementReset();
    setPosition(clampPosition({ x: rect.left, y: rect.top }, width, height));
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.lastClientX;
    if (Math.abs(deltaX) >= MIRA_DIRECTION_THRESHOLD) {
      const nextAction: MiraActionName = deltaX > 0 ? 'running_right' : 'running_left';
      drag.directionAction = nextAction;
      applyMovementAction(nextAction);
    }
    drag.lastClientX = event.clientX;

    setPosition(clampPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }, drag.width, drag.height));
    event.preventDefault();
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const next = clampPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }, drag.width, drag.height);
    setPosition(next);
    savePosition(next);
    setDragging(false);
    applyMovementAction(drag.directionAction, !!drag.directionAction);
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 12;

    if (event.key === 'ArrowLeft') {
      applyMovementAction('running_left', true);
      nudgePosition(-step, 0);
    } else if (event.key === 'ArrowRight') {
      applyMovementAction('running_right', true);
      nudgePosition(step, 0);
    } else if (event.key === 'ArrowUp') {
      nudgePosition(0, -step);
    } else if (event.key === 'ArrowDown') {
      nudgePosition(0, step);
    } else if (event.key === 'Home') {
      resetPosition();
    } else if (event.key === 'Enter' || event.key === ' ') {
      interact();
    } else {
      return;
    }

    event.preventDefault();
  };

  const spriteStyle: MiraSpriteStyle = {
    width: MIRA_FRAME_WIDTH,
    height: MIRA_FRAME_HEIGHT,
    backgroundImage: `url(${MIRA_SPRITESHEET_URL})`,
    backgroundSize: `${MIRA_FRAME_WIDTH * MIRA_SHEET_COLUMNS}px ${MIRA_FRAME_HEIGHT * MIRA_SHEET_ROWS}px`,
    '--mira-x': `${-activeFrame.col * MIRA_FRAME_WIDTH}px`,
    '--mira-y': `${-activeFrame.row * MIRA_FRAME_HEIGHT}px`,
  };
  const petStyle: CSSProperties | undefined = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
    : undefined;
  const movementStatusText = movementAction === 'running_left'
    ? '向左移动中'
    : movementAction === 'running_right'
      ? '向右移动中'
      : movementAction === 'waving'
        ? '向你打招呼'
        : movementAction === 'jumping'
          ? '开心跳一下'
          : null;
  const statusText = dragging ? (movementStatusText ?? '拖动中，松手保存位置') : (movementStatusText ?? MIRA_STATUS_LABELS[mood]);
  const petClassName = `mira-pet is-${mood}${dragging ? ' is-dragging' : ''}${movementAction ? ' is-moving' : ''}`;

  if (!mounted || !visible) return null;

  return (
    <div
      ref={petRef}
      className={petClassName}
      style={petStyle}
      role="button"
      tabIndex={0}
      aria-label={`安和昴 (486) 桌宠，${statusText}。Enter 或空格互动，方向键移动，Home 键回到默认位置。`}
      title={`${statusText} · 拖动可调整位置`}
      data-action={action.name}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={handleKeyDown}
    >
      <div className="mira-pet-bubble" aria-hidden="true">{statusText}</div>
      <div className="mira-pet-shadow" />
      <div className="mira-pet-frame">
        <div className="mira-pet-sprite" style={spriteStyle} />
      </div>
    </div>
  );
}
