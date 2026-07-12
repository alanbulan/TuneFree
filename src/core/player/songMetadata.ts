import { getLyrics } from "../services/api";
import { getSongKey, isSameSong } from "../types";
import type { Song } from "../types";
import {
  analyzeLyricTimeline,
  LYRIC_VERSION_MISMATCH_MESSAGE,
} from "../utils/lyrics/timeline";
import { shouldFetchBetterLyrics, shouldUseLyricCandidate } from "./playerUtils";
import type { ParsedSongData, ResolvedLyricBinding } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const isSameLyricBinding = (
  left: ResolvedLyricBinding | undefined,
  right: ResolvedLyricBinding | undefined,
): boolean => left?.source === right?.source &&
  left?.id === right?.id && left?.lyricId === right?.lyricId;

export const notifyLyricTimelineMismatch = (
  duration: number,
  setPlayerNotice: PlayerRuntime["setPlayerNotice"],
  lrc: string,
): void => {
  if (analyzeLyricTimeline(lrc, duration).status !== "overrun") return;
  setPlayerNotice({
    id: Date.now(), tone: "warning", message: LYRIC_VERSION_MISMATCH_MESSAGE,
  });
};

const updateLyrics = (
  runtime: PlayerRuntime,
  song: Song,
  binding: ResolvedLyricBinding,
  lrc: string,
): void => {
  const { refs, setCurrentSong, setQueue } = runtime;
  if (!isSameLyricBinding(refs.lyricBindings.current.get(getSongKey(song)), binding)) return;
  if (!isSameSong(refs.currentSong.current, song) ||
      !shouldUseLyricCandidate(refs.currentSong.current?.lrc, lrc)) return;
  notifyLyricTimelineMismatch(runtime.duration, runtime.setPlayerNotice, lrc);
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

export const getLyricRequest = (
  song: Song,
  binding: ResolvedLyricBinding | undefined,
): { id: string | number; source: string; songMeta: Song } | null => {
  if (!binding) return { id: song.id, source: song.source, songMeta: song };
  if (binding.id === undefined || binding.id === null) return null;
  return {
    id: binding.id,
    source: binding.source,
    songMeta: {
      ...song,
      lyricId: binding.lyricId === undefined ? undefined : String(binding.lyricId),
    },
  };
};

export const applyParsedMetadata = (
  runtime: PlayerRuntime,
  song: Song,
  current: Song,
  parsed: ParsedSongData | null,
): Song => {
  if (!parsed) return current;
  const lyricBinding: ResolvedLyricBinding = {
    source: parsed.resolvedSource,
    id: parsed.resolvedId,
    lyricId: parsed.resolvedLyricId,
  };
  runtime.refs.lyricBindings.current.set(getSongKey(song), lyricBinding);
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
  const lyricRequest = getLyricRequest(song, lyricBinding);
  if (lyricRequest && shouldFetchBetterLyrics({ source: lyricRequest.source }, fullSong.lrc)) {
    void getLyrics(lyricRequest.id, lyricRequest.source, lyricRequest.songMeta)
      .then((lrc) => updateLyrics(runtime, song, lyricBinding, lrc));
  }
  return fullSong;
};
