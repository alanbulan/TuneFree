import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { usePlayerNowPlaying } from '../../core/contexts/PlayerContext';
import {
  MIRA_ACTION_POOLS, MIRA_ACTIONS, MIRA_FRAME_HEIGHT, MIRA_FRAME_WIDTH,
  MIRA_SHEET_COLUMNS, MIRA_SHEET_ROWS, MIRA_SPRITESHEET_URL, type MiraMood,
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
  isNearEnd: boolean,
): MiraMood => {
  if (isLoading) return 'loading';
  if (isPlaying && isNearEnd) return 'celebrate';
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
  // 只订阅低频的 isNearEnd 派生值，不为一个阈值判断承担 10Hz 进度重渲染。
  const { currentSong, isPlaying, isLoading, isNearEnd } = usePlayerNowPlaying();
  const reducedMotion = useReducedMotion();
  const mood = getMood(!!currentSong, isPlaying, isLoading, isNearEnd);
  const actionPool = useMemo(() => MIRA_ACTION_POOLS[mood], [mood]);
  const baseActionName = actionPool[actionIndex % actionPool.length];
  const positionState = useMiraPetPosition();
  const { petRef, position, dragging, movementAction, applyMovementAction,
    handlePointerDown, handlePointerMove, finishDrag, handleKeyDown } = positionState;
  const actionName = movementAction ?? baseActionName;
  const action = MIRA_ACTIONS[actionName];
  // 帧序列由 desktop-widgets.css 的 step-end 关键帧驱动，这里只需要动作首帧作为静止兜底。
  const restFrame = action.frames[0];
  // CSS 动画每跑完一整轮触发一次 animationiteration，据此轮换到动作池的下一个动作。
  const advanceAction = useCallback(
    () => setActionIndex((current) => (current + 1) % actionPool.length),
    [actionPool.length],
  );

  useEffect(() => {
    setMounted(true);
    const updateVisibility = () =>
      setVisible(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    updateVisibility();
    window.addEventListener('tunefree_pet_toggle', updateVisibility);
    return () => window.removeEventListener('tunefree_pet_toggle', updateVisibility);
  }, []);
  useEffect(() => {
    setActionIndex(0);
    applyMovementAction(null);
  }, [applyMovementAction, mood]);
  // 减少动态时精灵帧动画被 CSS 关掉，收不到 animationiteration，用低频定时器轮换动作。
  useEffect(() => {
    if (!reducedMotion) return;
    const timer = window.setInterval(advanceAction, 5000);
    return () => window.clearInterval(timer);
  }, [advanceAction, reducedMotion]);

  if (!mounted || !visible) return null;
  const movementStatus = getMovementStatus(movementAction);
  const statusText = dragging
    ? movementStatus ?? '拖动中，松手保存位置'
    : movementStatus ?? STATUS_LABELS[mood];
  const spriteStyle: MiraSpriteStyle = {
    width: MIRA_FRAME_WIDTH, height: MIRA_FRAME_HEIGHT,
    backgroundImage: `url(${MIRA_SPRITESHEET_URL})`,
    backgroundSize: `${MIRA_FRAME_WIDTH * MIRA_SHEET_COLUMNS}px ${MIRA_FRAME_HEIGHT * MIRA_SHEET_ROWS}px`,
    '--mira-x': `${-restFrame.col * MIRA_FRAME_WIDTH}px`,
    '--mira-y': `${-restFrame.row * MIRA_FRAME_HEIGHT}px`,
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
      <div className="mira-pet-frame">
        <div className="mira-pet-sprite" style={spriteStyle}
          onAnimationIteration={() => { if (!movementAction) advanceAction(); }} />
      </div>
    </div>
  );
}
