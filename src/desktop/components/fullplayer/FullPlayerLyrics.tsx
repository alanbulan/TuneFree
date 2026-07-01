import { useLayoutEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MusicIcon } from '../../../core/components/Icons';
import { KaraokeLyricText } from '../../../core/components/KaraokeLyricText';
import {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerProgress,
} from '../../../core/contexts/PlayerContext';
import { useLyricDisplayMode } from '../../../core/hooks/useLyricDisplayMode';
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../../../core/utils/lyrics';
import {
  buildScoreNotes,
  getLyricExtensionLines,
  type NoteStyle,
  type OffsetStyle,
} from '../../utils/formatting';

interface FullPlayerLyricsProps {
  isOpen: boolean;
}

const LYRIC_WINDOW_RADIUS = 8;

export default function FullPlayerLyrics({ isOpen }: FullPlayerLyricsProps) {
  const { currentSong, isLoading } = usePlayerNowPlaying();
  const { currentTime, lyricOffsetSeconds } = usePlayerProgress();
  const { seek } = usePlayerActions();
  const lyricDisplayMode = useLyricDisplayMode();

  const lyricListRef = useRef<HTMLDivElement>(null);
  const lyricScrollKeyRef = useRef('');
  const prevActiveIndexRef = useRef(-1);

  const rawLyrics = currentSong?.lrc;
  const lyricRows = useMemo(() => parseLyrics(rawLyrics), [rawLyrics]);
  const activeLyricIndex = findActiveLyricIndex(lyricRows, currentTime, lyricOffsetSeconds);
  const lyricClock = currentTime + lyricOffsetSeconds;
  const activeLyric = activeLyricIndex >= 0 ? lyricRows[activeLyricIndex] : null;
  const lyricWindow = useMemo(() => {
    if (lyricRows.length === 0) return [];
    if (activeLyricIndex < 0) {
      return lyricRows.slice(0, LYRIC_WINDOW_RADIUS * 2 + 1).map((row, index) => ({ row, index }));
    }

    const start = Math.max(0, activeLyricIndex - LYRIC_WINDOW_RADIUS);
    const end = Math.min(lyricRows.length, activeLyricIndex + LYRIC_WINDOW_RADIUS + 1);
    return lyricRows.slice(start, end).map((row, offset) => ({ row, index: start + offset }));
  }, [activeLyricIndex, lyricRows]);
  const scoreText = activeLyric?.text || currentSong?.name || 'TuneFree Desktop';
  const scoreNotes = useMemo(
    () => buildScoreNotes(scoreText, currentTime),
    [currentTime, scoreText],
  );
  const hasSong = !!currentSong;
  const lyricsLoading = isLoading && hasSong && !rawLyrics;

  // P3-12: Only trigger scroll when activeLyricIndex actually changes.
  // Use 'smooth' for subsequent scrolls, 'auto' only for the initial scroll.
  useLayoutEffect(() => {
    if (!isOpen) {
      lyricScrollKeyRef.current = '';
      prevActiveIndexRef.current = -1;
      return;
    }
    if (activeLyricIndex === prevActiveIndexRef.current) return;
    prevActiveIndexRef.current = activeLyricIndex;

    if (!lyricListRef.current || activeLyricIndex < 0 || lyricRows.length === 0) return;

    const container = lyricListRef.current;
    const songKey = currentSong ? `${currentSong.source}:${currentSong.id}` : '';
    const scrollKey = `${songKey}:${lyricRows.length}:${rawLyrics?.length || 0}`;
    const isInitialScroll = lyricScrollKeyRef.current !== scrollKey;
    lyricScrollKeyRef.current = scrollKey;

    const scrollActiveLyric = (behavior: ScrollBehavior) => {
      const activeEl = container.querySelector<HTMLElement>('[data-active="true"]');
      if (!activeEl) return;

      const containerRect = container.getBoundingClientRect();
      const activeRect = activeEl.getBoundingClientRect();
      const top =
        container.scrollTop +
        activeRect.top -
        containerRect.top -
        container.clientHeight / 2 +
        activeRect.height / 2;

      container.scrollTo({ top, behavior });
    };

    let timeout = 0;

    const behavior: ScrollBehavior = isInitialScroll ? 'auto' : 'smooth';
    scrollActiveLyric(behavior);

    if (isInitialScroll) {
      timeout = window.setTimeout(() => scrollActiveLyric('auto'), 180);
    }

    return () => {
      if (timeout) window.clearTimeout(timeout);
    };
  }, [activeLyricIndex, lyricRows.length, lyricWindow, rawLyrics, isOpen, currentSong]);

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
      <div className="full-lyrics-content" style={{ position: 'relative', overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          {lyricWindow.length > 0 ? (
            <motion.div
              ref={lyricListRef}
              key={`lyrics-${currentSong?.id || 'none'}`}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              className="lyric-scroll lyric-scrollable"
              style={{ width: '100%', height: '100%' }}
            >
              {lyricWindow.map(({ row, index }: { row: ParsedLyric; index: number }) => {
                const offset = index - activeLyricIndex;
                const style: OffsetStyle = { '--lyric-offset': offset };
                return (
                  <div
                    role="listitem"
                    tabIndex={0}
                    className={`lyric-line ${offset === 0 ? 'active' : ''} ${Math.abs(offset) > 2 ? 'dim' : ''}`}
                    style={style}
                    key={`${row.time}-${row.text}`}
                    data-active={offset === 0 ? 'true' : undefined}
                    aria-live={offset === 0 ? 'polite' : undefined}
                    onClick={() => seek(Math.max(0, row.time))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        seek(Math.max(0, row.time));
                      }
                    }}
                  >
                    <span>{offset === 0 && lyricDisplayMode === 'karaoke' ? <KaraokeLyricText line={row} currentTime={lyricClock} source={currentSong?.source} /> : row.text}</span>
                    {getLyricExtensionLines(row).map((line, lineIndex) => (
                      <em key={`${row.time}-${lineIndex}-${line}`}>{line}</em>
                    ))}
                  </div>
                );
              })}
            </motion.div>
          ) : (
            <motion.div
              key={`empty-${lyricsLoading ? 'loading' : 'idle'}-${currentSong?.id || 'none'}`}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
              className="lyric-scroll lyric-empty"
              aria-live="polite"
              style={{ width: '100%', height: '100%', display: 'grid', justifyItems: 'center', alignContent: 'center', gap: '16px' }}
            >
              {lyricsLoading ? <span className="lyric-loading-dot" /> : <MusicIcon size={30} />}
              <p className="lyric-line active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                <span>{lyricsLoading ? '加载歌词中...' : currentSong?.name || 'TuneFree Desktop'}</span>
                <em>{lyricsLoading ? currentSong?.name || '' : currentSong?.artist || '选择一首音乐开始'}</em>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
