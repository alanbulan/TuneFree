import { RefObject, useEffect, useState } from "react";
import { getLyrics } from "../services/api";
import { ParsedLyric, Song } from "../types";
import { findActiveLyricIndex, parseLrc } from "./playerLyrics";

const EMPTY_LYRICS: ParsedLyric[] = [{ time: 0, text: "暂无歌词" }];

export const usePlayerLyrics = (
  currentSong: Song | null,
  isOpen: boolean,
  currentTime: number,
  showLyrics: boolean,
  lyricsContainerRef: RefObject<HTMLDivElement>,
) => {
  const [lyrics, setLyrics] = useState<ParsedLyric[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState(0);

  useEffect(() => {
    if (!isOpen || !currentSong) return;

    let cancelled = false;
    setLyrics([]);
    setActiveLyricIndex(0);

    const applyLyrics = (rawLrc: string) => {
      const parsed = parseLrc(rawLrc);
      if (cancelled) return;
      setLyrics(parsed.length > 0 ? parsed : EMPTY_LYRICS);
    };

    if (currentSong.lrc) {
      applyLyrics(currentSong.lrc);
      return () => {
        cancelled = true;
      };
    }

    getLyrics(currentSong.id, currentSong.source).then((rawLrc) => {
      if (!rawLrc) {
        if (!cancelled) setLyrics(EMPTY_LYRICS);
        return;
      }
      applyLyrics(rawLrc);
    });

    return () => {
      cancelled = true;
    };
  }, [currentSong, isOpen]);

  useEffect(() => {
    if (lyrics.length === 0) return;
    const index = findActiveLyricIndex(lyrics, currentTime);
    setActiveLyricIndex((prev) => (prev !== index ? index : prev));
  }, [currentTime, lyrics]);

  useEffect(() => {
    if (!showLyrics || !lyricsContainerRef.current || lyrics.length === 0) return;

    const activeEl = lyricsContainerRef.current.children[
      activeLyricIndex
    ] as HTMLElement;

    if (!activeEl) return;

    const container = lyricsContainerRef.current;
    const scrollNew =
      activeEl.offsetTop -
      container.clientHeight / 2 +
      activeEl.clientHeight / 2;

    container.scrollTo({ top: scrollNew, behavior: "smooth" });
  }, [activeLyricIndex, showLyrics, lyrics, lyricsContainerRef]);

  return {
    lyrics,
    activeLyricIndex,
  };
};
