import { getSongKey, isSameSong } from "../types";
import type { Song } from "../types";
import {
  analyzeLyricTimeline,
  LYRIC_VERSION_MISMATCH_MESSAGE,
} from "../utils/lyrics/timeline";
import {
  getFiniteAudioDuration,
  shouldUseLyricCandidate,
} from "./playerUtils";
import type { ParsedSongData, ResolvedLyricBinding } from "./types";
import type { PlayerRuntime } from "./usePlayerRuntime";

export const isSameLyricBinding = (
  left: ResolvedLyricBinding | undefined,
  right: ResolvedLyricBinding | undefined,
): boolean => left?.source === right?.source &&
  left?.id === right?.id && left?.lyricId === right?.lyricId;

export const notifyLyricTimelineMismatch = (
  runtime: Pick<PlayerRuntime, "duration" | "refs" | "setPlayerNotice">,
  song: Song,
  lrc: string,
  knownDuration = 0,
): boolean => {
  const audioDuration = runtime.refs.audio?.current
    ? getFiniteAudioDuration(runtime.refs.audio.current) : 0;
  const duration = knownDuration > 0 ? knownDuration : audioDuration || runtime.duration;
  if (analyzeLyricTimeline(lrc, duration).status !== "overrun") return false;
  const songKey = getSongKey(song);
  if (runtime.refs.lyricMismatchNoticedKey.current === songKey) return false;
  runtime.refs.lyricMismatchNoticedKey.current = songKey;
  runtime.setPlayerNotice({
    id: Date.now(), tone: "warning", message: LYRIC_VERSION_MISMATCH_MESSAGE,
  });
  return true;
};

/**
 * Apply a freshly fetched lyric to the current song and its queue entry.
 * Returns false when the response is stale or not an improvement over what is already shown.
 */
export const updateLyrics = (
  runtime: PlayerRuntime,
  song: Song,
  binding: ResolvedLyricBinding | undefined,
  lrc: string,
): boolean => {
  const { commitCurrentSong, commitQueue, refs } = runtime;
  if (!isSameLyricBinding(refs.lyricBindings.current.get(getSongKey(song)), binding)) return false;
  const current = refs.currentSong.current;
  if (!current || !isSameSong(current, song) ||
      !shouldUseLyricCandidate(current.lrc, lrc)) return false;
  notifyLyricTimelineMismatch(runtime, song, lrc);
  commitCurrentSong({ ...current, lrc });
  commitQueue((previous) => {
    let changed = false;
    const nextQueue = previous.map((queuedSong) => {
      if (!isSameSong(queuedSong, song) ||
          !shouldUseLyricCandidate(queuedSong.lrc, lrc)) return queuedSong;
      changed = true;
      return { ...queuedSong, lrc };
    });
    return changed ? nextQueue : previous;
  });
  return true;
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
      picId: binding.picId ?? (binding.source === song.source ? song.picId : undefined),
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
    ...(parsed.resolvedPicId ? { picId: parsed.resolvedPicId } : {}),
  };
  runtime.refs.lyricBindings.current.set(getSongKey(song), lyricBinding);
  const patch: Partial<Song> = {};
  if (parsed.url) patch.url = parsed.url;
  if (parsed.pic && !current.pic) patch.pic = parsed.pic;
  if (parsed.lrc) patch.lrc = parsed.lrc;
  let fullSong = current;
  if (Object.keys(patch).length > 0) {
    fullSong = { ...current, ...patch };
    runtime.commitCurrentSong(fullSong);
    runtime.commitQueue((previous) => {
      let changed = false;
      const nextQueue = previous.map((queuedSong) => {
        if (!isSameSong(queuedSong, song)) return queuedSong;
        changed = true;
        return { ...queuedSong, ...patch };
      });
      return changed ? nextQueue : previous;
    });
  }
  return fullSong;
};

export const updateCover = (
  runtime: PlayerRuntime, song: Song, binding: ResolvedLyricBinding | undefined, pic: string,
): void => {
  const current = runtime.refs.currentSong.current;
  if (!pic || !current || !isSameSong(current, song) || current.pic ||
    !isSameLyricBinding(runtime.refs.lyricBindings.current.get(getSongKey(song)), binding)) return;
  runtime.commitCurrentSong({ ...current, pic });
  runtime.commitQueue((previous) => previous.map((item) =>
    isSameSong(item, song) && !item.pic ? { ...item, pic } : item));
};
