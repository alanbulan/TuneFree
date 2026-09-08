import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/api", () => ({
  getLyrics: vi.fn().mockResolvedValue(""),
}));

import { getLyrics } from "../../services/api";
import type { Song } from "../../types";
import {
  applyParsedMetadata,
  getLyricRequest,
  notifyLyricTimelineMismatch,
  updateLyrics,
  updateCover,
} from "../songMetadata";
import type { ParsedSongData } from "../types";
import type { PlayerRuntime } from "../usePlayerRuntime";

const originalSong: Song = {
  id: "original-id",
  source: "kuwo",
  name: "Bound Song",
  artist: "Bound Artist",
  album: "",
  pic: "",
  lrc: "",
};

const createRuntime = (song: Song): PlayerRuntime => {
  const currentSong = { current: song };
  const queue = { current: [song] };
  return {
    refs: {
      audio: { current: null },
      currentSong,
      queue,
      lyricBindings: { current: new Map() },
      lyricMismatchNoticedKey: { current: null },
    },
    duration: 0,
    setPlayerNotice: vi.fn(),
    commitCurrentSong: vi.fn((next: Song | null) => {
      currentSong.current = next as Song;
    }),
    commitQueue: vi.fn((next) => {
      queue.current = typeof next === "function" ? next(queue.current) : next;
    }),
  } as unknown as PlayerRuntime;
};

describe("resolved lyric binding", () => {
  it('重复歌词保留已有节点，队列中更完整的歌词不退化，过期封面不覆盖', () => {
    const lyrics = '[00:01]一句';
    const runtime = createRuntime({ ...originalSong, lrc: lyrics });
    expect(updateLyrics(runtime, originalSong, undefined, lyrics)).toBe(false);
    expect(runtime.commitCurrentSong).not.toHaveBeenCalled();
    runtime.refs.currentSong.current = { ...originalSong, lrc: '' };
    runtime.refs.queue.current = [{ ...originalSong, lrc: lyrics }, { ...originalSong, id: 'other' }];
    const previous = runtime.refs.queue.current;
    expect(updateLyrics(runtime, originalSong, undefined, lyrics)).toBe(true);
    expect(runtime.refs.queue.current).toBe(previous);
    runtime.refs.lyricBindings.current.set('kuwo:original-id', { source: 'qq', id: 'new' });
    updateCover(runtime, originalSong, { source: 'qq', id: 'old' }, 'https://image.test/old.jpg');
    expect(runtime.refs.currentSong.current?.pic).toBe('');
    expect(runtime.commitCurrentSong).toHaveBeenCalledOnce();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes fallback lyrics with the fallback identity without changing song identity", () => {
    const runtime = createRuntime(originalSong);
    const parsed: ParsedSongData = {
      url: "https://example.com/fallback.mp3",
      lrc: "",
      pic: "",
      resolvedSource: "qq",
      resolvedId: "fallback-id",
      resolvedLyricId: "fallback-lyric-id",
    };

    const result = applyParsedMetadata(runtime, originalSong, originalSong, parsed);

    expect(result).toMatchObject({
      id: "original-id",
      source: "kuwo",
      url: "https://example.com/fallback.mp3",
    });
    expect(runtime.refs.currentSong.current).toMatchObject({
      id: "original-id",
      source: "kuwo",
    });
    expect(getLyricRequest(result, runtime.refs.lyricBindings.current.get('kuwo:original-id'))).toMatchObject({
      id: 'fallback-id', source: 'qq', songMeta: { lyricId: 'fallback-lyric-id' },
    });
    expect(getLyrics).not.toHaveBeenCalled();
  });

  it("does not refresh autosource lyrics when the service did not return a resolved id", () => {
    const runtime = createRuntime({ ...originalSong, source: "embeat" });
    const parsed: ParsedSongData = {
      url: "https://example.com/autosource.mp3",
      lrc: "",
      pic: "",
      resolvedSource: "netease",
    };

    applyParsedMetadata(runtime, runtime.refs.currentSong.current!, runtime.refs.currentSong.current!, parsed);

    expect(getLyrics).not.toHaveBeenCalled();
    expect(getLyricRequest(runtime.refs.currentSong.current!, {
      source: "netease",
    })).toBeNull();
  });

  it("uses the original identity when no parsed binding exists", () => {
    expect(getLyricRequest(originalSong, undefined)).toEqual({
      id: "original-id",
      source: "kuwo",
      songMeta: originalSong,
    });
  });

  it("ignores a late lyric response from an obsolete fallback binding", async () => {
    const runtime = createRuntime(originalSong);

    applyParsedMetadata(runtime, originalSong, originalSong, {
      url: "https://example.com/old.mp3",
      lrc: "[00:01.00]old fallback",
      pic: "",
      resolvedSource: "qq",
      resolvedId: "old-id",
    });
    applyParsedMetadata(runtime, originalSong, runtime.refs.currentSong.current!, {
      url: "https://example.com/current.mp3",
      lrc: "[00:01.00]current fallback",
      pic: "",
      resolvedSource: "netease",
      resolvedId: "current-id",
    });

    expect(updateLyrics(runtime, originalSong, { source: 'qq', id: 'old-id' },
      '[00:01.00]过期歌词')).toBe(false);

    expect(runtime.refs.currentSong.current).toMatchObject({
      url: "https://example.com/current.mp3",
      lrc: "[00:01.00]current fallback",
    });
  });

  it("uses a valid media duration and only reports a mismatch once per song", () => {
    const runtime = createRuntime(originalSong);
    const lrc = "[03:20.00]仍在唱\n[03:30.00]继续唱\n[04:10.00]最后一句";

    expect(notifyLyricTimelineMismatch(runtime, originalSong, lrc, 200)).toBe(true);
    expect(notifyLyricTimelineMismatch(runtime, originalSong, lrc, 200)).toBe(false);
    expect(runtime.setPlayerNotice).toHaveBeenCalledTimes(1);
  });
});
