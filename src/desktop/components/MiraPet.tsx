import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Smile } from 'lucide-react';
import { usePlayerNowPlaying } from '../../core/contexts/PlayerContext';
import type { StateId } from '../../../vendor/bloub/src/bot/states';
import { useCompanionThinking } from '../hooks/useCompanionThinking';
import { useMiraPetPosition, useReducedMotion } from './useMiraPetPosition';
import BloubMenu from './BloubMenu';
import { getBloubSelectionLabel, type BloubSelection } from './bloubCatalog';

const BloubAvatar = lazy(() => import('./BloubAvatar'));
type CompanionMood = 'empty' | 'loading' | 'playing' | 'paused' | 'celebrate' | 'thinking';
const STATUS_LABELS: Record<CompanionMood, string> = {
  empty: '音乐还没开始，我先陪你一会儿',
  loading: '正在准备音乐',
  playing: '好音乐，一起听',
  paused: '暂停一下，也很好',
  celebrate: '快到结尾啦，准备下一首',
  thinking: '正在为你挑选音乐',
};
const BOT_STATES: Record<CompanionMood, StateId> = {
  empty: 'idle', loading: 'thinking', playing: 'orbit', paused: 'idle',
  celebrate: 'burst', thinking: 'thinking',
};

export default function BloubCompanion({ aiBusy = false }: { aiBusy?: boolean }) {
  const [visible, setVisible] = useState(() => localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 860px)').matches);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selection, setSelection] = useState<BloubSelection | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const { currentSong, isPlaying, isLoading, isNearEnd } = usePlayerNowPlaying();
  const thinking = useCompanionThinking(aiBusy);
  const reducedMotion = useReducedMotion();
  const { petRef, position, dragging, movementAction, handlePointerDown,
    handlePointerMove, finishDrag, handleKeyDown } = useMiraPetPosition();
  const mood: CompanionMood = thinking ? 'thinking'
    : isLoading ? 'loading' : isPlaying ? (isNearEnd ? 'celebrate' : 'playing')
      : currentSong ? 'paused' : 'empty';

  useEffect(() => {
    const updateVisibility = () =>
      setVisible(localStorage.getItem('tunefree_desktop_show_pet') !== 'false');
    const updatePageVisibility = () => setPageVisible(!document.hidden);
    const media = window.matchMedia('(max-width: 860px)');
    const updateLayout = () => setCompact(media.matches);
    window.addEventListener('tunefree_pet_toggle', updateVisibility);
    document.addEventListener('visibilitychange', updatePageVisibility);
    media.addEventListener('change', updateLayout);
    return () => {
      window.removeEventListener('tunefree_pet_toggle', updateVisibility);
      document.removeEventListener('visibilitychange', updatePageVisibility);
      media.removeEventListener('change', updateLayout);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!petRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
      event.stopPropagation();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menuOpen, petRef]);

  useEffect(() => {
    // 一次性动作完整播放后回到音乐状态，避免绽放/彗星收尾后一直只剩一个小点。
    if (selection?.kind !== 'state') return;
    const timer = window.setTimeout(() => setSelection(null), 4200);
    return () => window.clearTimeout(timer);
  }, [selection]);

  if (!visible || compact) return null;
  const gesturing = movementAction !== null;
  const previewState = selection?.kind === 'state' ? selection.id : selection ? 'idle' : null;
  const state: StateId = dragging ? 'wide' : movementAction ?? previewState ?? BOT_STATES[mood];
  const expression = selection?.kind === 'expression' ? selection.id : mood === 'paused' ? 'somnolent' : 'neutre';
  const statusText = dragging ? '松手后记住这个位置'
    : gesturing ? (movementAction === 'wink' ? '收到，你好呀' : '把好心情送给你')
      : selection ? getBloubSelectionLabel(selection) : STATUS_LABELS[mood];
  const petStyle: CSSProperties | undefined = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined;
  const bubbleLeft = !!position && position.x > window.innerWidth - 340;
  const bubbleBelow = !!position && position.y < 110;
  const menuStyle: CSSProperties = {
    left: Math.max(8, Math.min(window.innerWidth - 304, (position?.x ?? 52) + (bubbleLeft ? -292 : 96))),
    top: Math.max(8, Math.min(window.innerHeight - 420, (position?.y ?? window.innerHeight - 232) - 110)),
  };

  return (
    <motion.div ref={petRef} className={`bloub-companion is-${mood}${dragging ? ' is-dragging' : ''}`}
      style={petStyle} data-state={state} data-expression={expression}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <div className="companion-handle" role="button" tabIndex={0}
        aria-label={`Bloub 音乐伙伴，${statusText}。点击、Enter 或空格打招呼，方向键移动，Home 键复位，右键打开动作面板。`}
        title={`${statusText} · 点击打招呼，拖动调整位置`} onContextMenu={(event) => {
          event.preventDefault(); setMenuOpen(true);
        }}
        onPointerDown={handlePointerDown} onPointerMove={handlePointerMove}
        onPointerUp={finishDrag} onPointerCancel={finishDrag} onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            event.preventDefault(); setMenuOpen(true);
          } else handleKeyDown(event);
        }}>
        {pageVisible && (
          <Suspense fallback={<span className="companion-loading" aria-hidden="true" />}>
            <BloubAvatar state={state} frozen={reducedMotion}
              expression={expression}
              shape={selection?.kind === 'shape' ? selection.id : undefined}
              followPointer={selection?.kind !== 'expression'} />
          </Suspense>
        )}
      </div>
      <div className={`companion-bubble${bubbleLeft ? ' is-left' : ''}${bubbleBelow ? ' is-below' : ''}`}
        aria-hidden="true">{statusText}</div>
      <button ref={menuButtonRef} type="button" className="companion-menu-trigger" aria-label="Bloub 动作与表情"
        aria-expanded={menuOpen} aria-haspopup="dialog" onClick={() => setMenuOpen((open) => !open)}><Smile size={15} /></button>
      <AnimatePresence>
        {menuOpen && pageVisible && <BloubMenu selection={selection} style={menuStyle}
          onSelect={setSelection} onClose={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }} />}
      </AnimatePresence>
    </motion.div>
  );
}
