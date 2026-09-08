import { useLayoutEffect, useMemo, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';
import { MusicIcon } from '../../../core/components/Icons';
import {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerProgress,
} from '../../../core/contexts/PlayerContext';
import { useLyricDisplayMode } from '../../../core/hooks/useLyricDisplayMode';
import { findActiveLyricIndex, parseLyrics } from '../../../core/utils/lyrics';
import { buildScoreNotes, type NoteStyle } from '../../utils/formatting';
import MotionPanel from '../MotionPanel';
import FullPlayerLyricLine from './FullPlayerLyricLine';

interface FullPlayerLyricsProps {
  isOpen: boolean;
}

export default function FullPlayerLyrics({ isOpen }: FullPlayerLyricsProps) {
  const { currentSong, isLoading } = usePlayerNowPlaying();
  const { currentTime, lyricOffsetSeconds } = usePlayerProgress();
  const { seek } = usePlayerActions();
  const lyricDisplayMode = useLyricDisplayMode();
  const reducedMotion = useReducedMotion();

  const lyricListRef = useRef<HTMLDivElement>(null);
  const lyricScrollKeyRef = useRef('');

  const rawLyrics = currentSong?.lrc;
  const lyricRows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeLyricIndex = findActiveLyricIndex(
    lyricRows,
    currentTime,
    lyricOffsetSeconds,
    lyricDisplayMode,
  );
  const lyricClock = currentTime + lyricOffsetSeconds;
  const activeLyric = activeLyricIndex >= 0 ? lyricRows[activeLyricIndex] : null;
  const scoreText = activeLyric?.text || currentSong?.name || 'TuneFree Desktop';
  // 漂浮音符是纯装饰的 infinite 动画，只在换行时重建一次；相位错开完全由 index 派生的
  // 固定负延迟给出（传 0 即取消对播放进度的依赖），不能跟着 10Hz 的 currentTime 重算，
  // 否则每 100ms 就会重设一次动画相位，音符会加速并微跳。
  const scoreNotes = useMemo(() => buildScoreNotes(scoreText, 0), [scoreText]);
  const hasSong = !!currentSong;
  const lyricsLoading = isLoading && hasSong && !rawLyrics;
  const songKey = currentSong ? `${currentSong.source}:${currentSong.id}` : 'none';

  // 行和逐字节点保持挂载，尺寸不随高亮变化；仅换行、换歌或尺寸变化时滚动。
  useLayoutEffect(() => {
    if (!isOpen) {
      lyricScrollKeyRef.current = '';
      return;
    }
    if (!lyricListRef.current || activeLyricIndex < 0 || lyricRows.length === 0) return;
    const container = lyricListRef.current;
    const activeEl = container.querySelector<HTMLElement>('[data-active="true"]');
    if (!activeEl) return;
    const scrollKey = `${songKey}:${rawLyrics}:${lyricDisplayMode}`;
    const isInitialScroll = lyricScrollKeyRef.current !== scrollKey;
    lyricScrollKeyRef.current = scrollKey;
    const scrollActiveLyric = (behavior: ScrollBehavior) => {
      // offset 不含入场/高亮的 transform，避免滚到动画中间的临时坐标。
      container.scrollTo({
        top: activeEl.offsetTop + activeEl.offsetHeight / 2 - container.clientHeight / 2,
        behavior,
      });
    };
    scrollActiveLyric(isInitialScroll || reducedMotion ? 'auto' : 'smooth');
    let dimensions = `${container.clientWidth}:${container.clientHeight}:${activeEl.offsetHeight}`;
    const observer = new ResizeObserver(() => {
      const next = `${container.clientWidth}:${container.clientHeight}:${activeEl.offsetHeight}`;
      if (next === dimensions) return;
      dimensions = next;
      scrollActiveLyric('auto');
    });
    observer.observe(container);
    observer.observe(activeEl);
    return () => observer.disconnect();
  }, [activeLyricIndex, lyricRows.length, rawLyrics, lyricDisplayMode, isOpen, songKey, reducedMotion]);

  return (
    <div className="full-lyrics-stage">
      <div className="lyric-orbit" aria-hidden="true" />
      <div className="lyric-score" aria-hidden="true">
        <div className="score-staff">
          {Array.from({ length: 5 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
        {scoreNotes.map((note, index) => {
          const style: NoteStyle = {
            top: `${note.top}%`,
            left: `${note.left}%`,
            '--note-delay': `${note.delay.toFixed(2)}s`,
            '--note-duration': `${note.duration.toFixed(2)}s`,
            '--note-drift': `${note.drift}px`,
          };

          return (
            <span className="score-note" style={style} key={`${note.glyph}-${index}`}>
              {note.glyph}
            </span>
          );
        })}
      </div>
      <MotionPanel className="full-lyrics-content" transitionKey={`${songKey}:${lyricRows.length > 0 ? 'lyrics' : lyricsLoading}`}>
          {lyricRows.length > 0 ? (
            <div ref={lyricListRef} className="lyric-scroll lyric-scrollable" role="list" aria-label="歌词">
              {lyricRows.map((row, index) => (
                <FullPlayerLyricLine key={`${songKey}:${index}:${row.time}`} row={row}
                  active={index === activeLyricIndex} dim={Math.abs(index - activeLyricIndex) > 2}
                  currentTime={index === activeLyricIndex ? lyricClock : index < activeLyricIndex ? Number.MAX_SAFE_INTEGER : -Number.MAX_SAFE_INTEGER}
                  mode={lyricDisplayMode} onSeek={seek} />
              ))}
            </div>
          ) : (
            <div className="lyric-scroll lyric-empty" aria-live="polite">
              {lyricsLoading ? <span className="lyric-loading-dot" /> : <MusicIcon size={30} />}
              <p className="lyric-line active">
                <span>{lyricsLoading ? '加载歌词中...' : currentSong?.name || 'TuneFree Desktop'}</span>
                <em>{lyricsLoading ? currentSong?.name || '' : currentSong?.artist || '选择一首音乐开始'}</em>
              </p>
            </div>
          )}
      </MotionPanel>
    </div>
  );
}
