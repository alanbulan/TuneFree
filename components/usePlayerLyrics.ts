import { RefObject, useEffect, useMemo, useState } from 'react';
import { getLyrics } from '../services/api';
import { Song } from '../types';
import { findActiveLyricIndex, parseLyrics, type ParsedLyric } from '../utils/lyrics';
import { useLyricDisplayMode } from './useLyricDisplayMode';

const EMPTY_LYRICS: ParsedLyric[] = [{ time: 0, text: '暂无歌词' }];

const getSongKey = (song: Song | null): string | null =>
  song ? `${song.source}:${song.id}` : null;

/**
 * 歌词加载 + 活跃行解析 + 自动滚动。
 *
 * 歌词解析交给 utils/lyrics（支持 [offset:]、多轨标记、逐字时间轴），
 * 活跃行判定与逐字填充统一使用加上用户偏移后的歌词时钟。
 */
export const usePlayerLyrics = (
  currentSong: Song | null,
  isOpen: boolean,
  currentTime: number,
  showLyrics: boolean,
  lyricsContainerRef: RefObject<HTMLDivElement>,
  lyricOffsetSeconds: number,
) => {
  const [rawLyrics, setRawLyrics] = useState('');
  // 只有"确实取过歌词"之后才用空态占位，加载过程中保持空数组以便上层显示加载动画。
  const [resolvedSongKey, setResolvedSongKey] = useState<string | null>(null);
  const lyricDisplayMode = useLyricDisplayMode();

  useEffect(() => {
    if (!isOpen || !currentSong) return;

    let cancelled = false;
    setRawLyrics('');
    setResolvedSongKey(null);

    if (currentSong.lrc) {
      setRawLyrics(currentSong.lrc);
      setResolvedSongKey(getSongKey(currentSong));
      return () => {
        cancelled = true;
      };
    }

    getLyrics(currentSong.id, currentSong.source, currentSong).then((rawLrc) => {
      if (cancelled) return;
      setRawLyrics(rawLrc || '');
      setResolvedSongKey(getSongKey(currentSong));
    });

    return () => {
      cancelled = true;
    };
  }, [currentSong, isOpen]);

  const lyrics = useMemo(() => {
    const rows = parseLyrics(rawLyrics);
    if (rows.length > 0) return rows;
    return resolvedSongKey ? EMPTY_LYRICS : [];
  }, [rawLyrics, resolvedSongKey]);

  const lyricClock = currentTime + lyricOffsetSeconds;
  const activeLyricIndex = findActiveLyricIndex(
    lyrics,
    currentTime,
    lyricOffsetSeconds,
    lyricDisplayMode,
  );

  useEffect(() => {
    if (!showLyrics || !lyricsContainerRef.current || lyrics.length === 0) return;
    if (activeLyricIndex < 0) return;

    const activeEl = lyricsContainerRef.current.querySelector<HTMLElement>(
      '[data-active="true"]',
    );
    if (!activeEl) return;

    const container = lyricsContainerRef.current;
    container.scrollTo({
      top: activeEl.offsetTop + activeEl.offsetHeight / 2 - container.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [activeLyricIndex, showLyrics, lyrics, lyricDisplayMode, lyricsContainerRef]);

  return {
    lyrics,
    activeLyricIndex,
    lyricClock,
    lyricDisplayMode,
    rawLyrics,
  };
};
