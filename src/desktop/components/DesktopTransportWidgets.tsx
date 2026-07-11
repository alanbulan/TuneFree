import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { usePlayerNowPlaying, usePlayerProgress } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { useLyricDisplayMode } from '../../core/hooks/useLyricDisplayMode';
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../../core/utils/lyrics';
import { useToast } from './ToastHost';

const getSecondary = (row: ParsedLyric | null): string =>
  row?.romanization || row?.pronunciation || row?.translation || row?.extra?.[0]?.text || '';

export function TransportMiniLyric({ onExpand }: { onExpand: () => void }) {
  const { currentSong } = usePlayerNowPlaying();
  const { currentTime, lyricOffsetSeconds } = usePlayerProgress();
  const displayMode = useLyricDisplayMode();
  const rows = useMemo(() => parseLyrics(currentSong?.lrc), [currentSong?.lrc]);
  const activeIndex = findActiveLyricIndex(rows, currentTime, lyricOffsetSeconds, displayMode);
  const activeLyric = activeIndex >= 0 ? rows[activeIndex] : null;
  const secondary = getSecondary(activeLyric);
  return (
    <button type="button" className="transport-mini-lyric" onClick={onExpand}
      aria-label="打开全屏歌词" style={{ position: 'relative', overflow: 'hidden', display: 'flex',
        flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <AnimatePresence mode="popLayout">
        <motion.div key={activeLyric?.text || currentSong?.name || 'empty'}
          initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            width: '100%', pointerEvents: 'none' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text)', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%' }}>
            {activeLyric?.text || currentSong?.name || 'TuneFree Desktop'}
          </span>
          {secondary && (
            <em style={{ fontSize: '11px', fontStyle: 'normal', opacity: 0.65, marginTop: '2px',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '90%' }}>
              {secondary}
            </em>
          )}
        </motion.div>
      </AnimatePresence>
    </button>
  );
}

export function DesktopLyricToggle() {
  const { showDesktopLyric, setShowDesktopLyric, lockDesktopLyric, setLockDesktopLyric } = useTheme();
  const { showToast } = useToast();
  const state = !showDesktopLyric ? 'off' : lockDesktopLyric ? 'locked' : 'floating';
  const label = state === 'off' ? 'LRC' : state === 'floating' ? '浮动' : '锁定';
  const title = state === 'off' ? '打开桌面歌词' :
    state === 'floating' ? '锁定桌面歌词（鼠标穿透）' : '关闭桌面歌词';
  const ariaLabel = state === 'off' ? '打开桌面歌词' :
    state === 'floating' ? '锁定桌面歌词' : '关闭桌面歌词';
  const cycle = () => {
    if (state === 'off') {
      setLockDesktopLyric(false); setShowDesktopLyric(true);
      showToast('桌面歌词已打开', 'success'); return;
    }
    if (state === 'floating') {
      setLockDesktopLyric(true); showToast('桌面歌词已锁定（鼠标穿透）', 'success'); return;
    }
    setLockDesktopLyric(false); setShowDesktopLyric(false);
    showToast('桌面歌词已关闭', 'success');
  };
  return (
    <button type="button" className={`lyric-toggle-btn ${showDesktopLyric ? 'active' : ''} ${lockDesktopLyric ? 'locked' : ''}`}
      title={`${title}；右击可单独${lockDesktopLyric ? '解锁' : '锁定'}`} aria-label={ariaLabel} onClick={cycle}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!showDesktopLyric) {
          setLockDesktopLyric(false); setShowDesktopLyric(true); showToast('桌面歌词已打开', 'success'); return;
        }
        const nextLock = !lockDesktopLyric;
        setLockDesktopLyric(nextLock);
        showToast(nextLock ? '桌面歌词已锁定（鼠标穿透）' : '桌面歌词已解锁', 'success');
      }}
      style={{ background: 'transparent', fontSize: '11px', fontWeight: 800, padding: '4px 7px',
        borderRadius: '6px', color: showDesktopLyric ? (lockDesktopLyric ? 'var(--ios-card)' : 'var(--accent)') : 'var(--muted)',
        backgroundColor: showDesktopLyric ? (lockDesktopLyric ? 'var(--accent)' : 'rgba(var(--accent-rgb), 0.10)') : 'transparent',
        border: showDesktopLyric ? '1px solid var(--accent)' : '1px solid var(--line)', cursor: 'pointer',
        transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
        flex: '0 0 auto', height: '24px', width: lockDesktopLyric ? '54px' : '42px', marginLeft: '6px',
        lineHeight: 1, whiteSpace: 'nowrap', boxShadow: showDesktopLyric ? '0 2px 8px rgba(var(--accent-rgb), 0.35)' : 'none' }}>
      {showDesktopLyric && lockDesktopLyric && <Lock size={10} style={{ flex: '0 0 auto' }} />}
      <span style={{ flex: '0 0 auto' }}>{label}</span>
    </button>
  );
}
