import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { usePlayerNowPlaying, usePlayerProgress } from '../../core/contexts/PlayerContext';
import {
  MIRA_ACTION_POOLS, MIRA_ACTIONS, MIRA_FRAME_HEIGHT, MIRA_FRAME_WIDTH,
  MIRA_SHEET_COLUMNS, MIRA_SHEET_ROWS, MIRA_SPRITESHEET_URL,
  validateMiraActionCoverage, type MiraMood,
} from './miraPetAtlas';
import { useMiraPetPosition, useReducedMotion } from './useMiraPetPosition';

type MiraSpriteStyle = CSSProperties & { '--mira-x': string; '--mira-y': string };
const STATUS_LABELS: Record<MiraMood, string> = {
  empty: '待命中，拖我换位置', loading: '加载中，我在找歌',
  playing: '播放中，跟着节奏动起来', paused: '暂停中，陪你休息一下',
  celebrate: '快到结尾啦，准备下一首',
};

const getMood = (
  hasSong: boolean,
  isPlaying: boolean,
  isLoading: boolean,
  progressRatio: number,
): MiraMood => {
  if (isLoading) return 'loading';
  if (isPlaying && progressRatio > 0.92) return 'celebrate';
  if (isPlaying) return 'playing';
  return hasSong ? 'paused' : 'empty';
};

const getMovementStatus = (action: string | null): string | null => {
  if (action === 'running_left') return '向左移动中';
  if (action === 'running_right') return '向右移动中';
  if (action === 'waving') return '向你打招呼';
  if (action === 'jumping') return '开心跳一下';
  return null;
};

export default function MiraPet() {
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [actionIndex, setActionIndex] = useState(0);
  const [frameIndex, setFrameIndex] = useState(0);
  const validatedRef = useRef(false);
  const { currentSong, isPlaying, isLoading } = usePlayerNowPlaying();
  const { currentTime, duration } = usePlayerProgress();
  const reducedMotion = useReducedMotion();
  const mood = getMood(!!currentSong, isPlaying, isLoading, duration > 0 ? currentTime / duration : 0);
  const actionPool = useMemo(() => MIRA_ACTION_POOLS[mood], [mood]);
  const baseActionName = actionPool[actionIndex % actionPool.length];
  const positionState = useMiraPetPosition();
  const { petRef, position, dragging, movementAction, applyMovementAction,
    handlePointerDown, handlePointerMove, finishDrag, handleKeyDown } = positionState;
  const actionName = movementAction ?? baseActionName;
  const action = MIRA_ACTIONS[actionName];
  const activeFrameIndex = frameIndex % action.frames.length;
  const activeFrame = action.frames[activeFrameIndex] || action.frames[0];
  const frameDuration = action.frameDurations[activeFrameIndex] ?? action.frameDurations[0];

  useEffect(() => {
    setMounted(true);
    const updateVisibility = () =>
      setVisible(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    updateVisibility();
    window.addEventListener('tunefree_pet_toggle', updateVisibility);
    return () => window.removeEventListener('tunefree_pet_toggle', updateVisibility);
  }, []);
  useEffect(() => {
    if (validatedRef.current || process.env.NODE_ENV === 'production') return;
    validatedRef.current = true;
    validateMiraActionCoverage();
  }, []);
  useEffect(() => {
    setActionIndex(0);
    setFrameIndex(0);
    applyMovementAction(null);
  }, [applyMovementAction, mood]);
  useEffect(() => { setFrameIndex(0); }, [actionName]);
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
    }, frameDuration);
    return () => window.clearInterval(timer);
  }, [action.frames.length, actionPool.length, frameDuration, movementAction, reducedMotion]);

  if (!mounted || !visible) return null;
  const movementStatus = getMovementStatus(movementAction);
  const statusText = dragging
    ? movementStatus ?? '拖动中，松手保存位置'
    : movementStatus ?? STATUS_LABELS[mood];
  const spriteStyle: MiraSpriteStyle = {
    width: MIRA_FRAME_WIDTH, height: MIRA_FRAME_HEIGHT,
    backgroundImage: `url(${MIRA_SPRITESHEET_URL})`,
    backgroundSize: `${MIRA_FRAME_WIDTH * MIRA_SHEET_COLUMNS}px ${MIRA_FRAME_HEIGHT * MIRA_SHEET_ROWS}px`,
    '--mira-x': `${-activeFrame.col * MIRA_FRAME_WIDTH}px`,
    '--mira-y': `${-activeFrame.row * MIRA_FRAME_HEIGHT}px`,
  };
  const petStyle: CSSProperties | undefined = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined;
  const className = `mira-pet is-${mood}${dragging ? ' is-dragging' : ''}${movementAction ? ' is-moving' : ''}`;
  return (
    <div ref={petRef} className={className} style={petStyle} role="button" tabIndex={0}
      aria-label={`安和昴 (486) 桌宠，${statusText}。Enter 或空格互动，方向键移动，Home 键回到默认位置。`}
      title={`${statusText} · 拖动可调整位置`} data-action={action.name}
      onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
      onPointerUp={finishDrag} onPointerCancel={finishDrag}
      onKeyDown={(event) => handleKeyDown(event, actionName)}>
      <div className="mira-pet-bubble" aria-hidden="true">{statusText}</div>
      <div className="mira-pet-shadow" />
      <div className="mira-pet-frame"><div className="mira-pet-sprite" style={spriteStyle} /></div>
    </div>
  );
}
