import { getLyrics } from "../services/api";
import { isSameSong } from "../types";
import type { Song } from "../types";
import { shouldFetchBetterLyrics, shouldUseLyricCandidate } from "./playerUtils";
import type { ParsedSongData } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

const updateLyrics = (runtime: PlayerRuntime, song: Song, lrc: string): void => {
  const { refs, setCurrentSong, setQueue } = runtime;
  if (!isSameSong(refs.currentSong.current, song) ||
      !shouldUseLyricCandidate(refs.currentSong.current?.lrc, lrc)) return;
  setCurrentSong((previous) => {
    if (!previous || !isSameSong(previous, song) ||
        !shouldUseLyricCandidate(previous.lrc, lrc)) return previous;
    const nextSong = { ...previous, lrc };
    refs.currentSong.current = nextSong;
    return nextSong;
  });
  setQueue((previous) => {
    const nextQueue = previous.map((queuedSong) =>
      isSameSong(queuedSong, song) && shouldUseLyricCandidate(queuedSong.lrc, lrc)
        ? { ...queuedSong, lrc } : queuedSong,
    );
    refs.queue.current = nextQueue;
    return nextQueue;
  });
};

export const applyParsedMetadata = (
  runtime: PlayerRuntime,
  song: Song,
  current: Song,
  parsed: ParsedSongData | null,
): Song => {
  if (!parsed) return current;
  const patch: Partial<Song> = {};
  if (parsed.url) patch.url = parsed.url;
  if (parsed.pic && !current.pic) patch.pic = parsed.pic;
  if (parsed.lrc) patch.lrc = parsed.lrc;
  let fullSong = current;
  if (Object.keys(patch).length > 0) {
    fullSong = { ...current, ...patch };
    runtime.refs.currentSong.current = fullSong;
    runtime.setCurrentSong((previous) =>
      previous && isSameSong(previous, song) ? { ...previous, ...patch } : previous,
    );
    runtime.setQueue((previous) => {
      const nextQueue = previous.map((queuedSong) =>
        isSameSong(queuedSong, song) ? { ...queuedSong, ...patch } : queuedSong,
      );
      runtime.refs.queue.current = nextQueue;
      return nextQueue;
    });
  }
  if (shouldFetchBetterLyrics(song, fullSong.lrc)) {
    void getLyrics(song.id, song.source, song).then((lrc) => updateLyrics(runtime, song, lrc));
  }
  return fullSong;
};
