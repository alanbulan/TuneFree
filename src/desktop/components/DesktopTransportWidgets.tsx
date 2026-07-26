import { memo, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import { usePlayerNowPlaying, usePlayerProgress } from '../../core/contexts/PlayerContext';
import { useTheme } from '../../core/contexts/ThemeContext';
import { useLyricDisplayMode } from '../../core/hooks/useLyricDisplayMode';
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../../core/utils/lyrics';
import { useToast } from './ToastHost';

const getSecondary = (row: ParsedLyric | null): string =>
  row?.romanization || row?.pronunciation || row?.translation || row?.extra?.[0]?.text || '';

function MiniLyric({ onExpand }: { onExpand: () => void }) {
  const { currentSong } = usePlayerNowPlaying();
  const { currentTime, lyricOffsetSeconds } = usePlayerProgress();
  const displayMode = useLyricDisplayMode();
  const rows = useMemo(() => parseLyrics(currentSong?.lrc), [currentSong?.lrc]);
  const activeIndex = findActiveLyricIndex(rows, currentTime, lyricOffsetSeconds, displayMode);
  const activeLyric = activeIndex >= 0 ? rows[activeIndex] : null;
  const secondary = getSecondary(activeLyric);
  return (
    <button type="button" className="transport-mini-lyric" onClick={onExpand} aria-label="打开全屏歌词">
      <AnimatePresence mode="popLayout">
        <motion.div key={activeLyric?.text || currentSong?.name || 'empty'}
          className="transport-mini-lyric-body"
          initial={{ y: 8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -8, opacity: 0 }}
          transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}>
          <span className="transport-mini-lyric-text">
            {activeLyric?.text || currentSong?.name || 'TuneFree Desktop'}
          </span>
          {secondary && <em className="transport-mini-lyric-sub">{secondary}</em>}
        </motion.div>
      </AnimatePresence>
    </button>
  );
}

/** 迷你歌词自订阅 10Hz 进度，memo 至少把底栏其它状态变化挡在外面。 */
export const TransportMiniLyric = memo(MiniLyric);

function LyricToggle() {
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
      }}>
      {showDesktopLyric && lockDesktopLyric && <Lock size={10} />}
      <span>{label}</span>
    </button>
  );
}

/** 无 props，memo 后完全不受底栏其它状态影响。 */
export const DesktopLyricToggle = memo(LyricToggle);
