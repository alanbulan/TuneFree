import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/api", () => ({
  getLyrics: vi.fn().mockResolvedValue(""),
}));

import { getLyrics } from "../../services/api";
import type { Song } from "../../types";
import { applyParsedMetadata, getLyricRequest } from "../songMetadata";
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
      currentSong,
      queue,
      lyricBindings: { current: new Map() },
    },
    setCurrentSong: vi.fn((updater) => {
      currentSong.current = typeof updater === "function" ? updater(currentSong.current) : updater;
    }),
    setQueue: vi.fn((updater) => {
      queue.current = typeof updater === "function" ? updater(queue.current) : updater;
    }),
  } as unknown as PlayerRuntime;
};

describe("resolved lyric binding", () => {
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
    expect(getLyrics).toHaveBeenCalledWith(
      "fallback-id",
      "qq",
      expect.objectContaining({
        id: "original-id",
        source: "kuwo",
        lyricId: "fallback-lyric-id",
      }),
    );
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
    let resolveOldLyrics: (lrc: string) => void = () => {};
    vi.mocked(getLyrics)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldLyrics = resolve; }))
      .mockResolvedValueOnce("");
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

    resolveOldLyrics("[tunefree:main]\n[00:01.00]old fallback\n\n[tunefree:translation]\n[00:01.00]过期翻译");
    await Promise.resolve();
    await Promise.resolve();

    expect(runtime.refs.currentSong.current).toMatchObject({
      url: "https://example.com/current.mp3",
      lrc: "[00:01.00]current fallback",
    });
  });
});
