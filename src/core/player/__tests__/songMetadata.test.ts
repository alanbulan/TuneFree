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

  it('延后获取歌词使用跨源候选的 URL、专辑和音质标识', () => {
    const song = { ...originalSong, urlId: 'old-url', hash: 'old-hash', albumId: 'old-album',
      qualityHashes: { flac: { hash: 'old-flac' } } };
    const matched = { name: song.name, artist: song.artist, album: '匹配专辑',
      urlId: 'new-url', lyricId: 'new-lyric', picId: 'new-pic', hash: 'new-hash',
      albumId: 'new-album', qualityHashes: { flac: { hash: 'new-flac' } } };
    const runtime = createRuntime(song);
    applyParsedMetadata(runtime, song, song, {
      url: 'https://example.com/fallback.mp3', lrc: '', pic: '',
      resolvedSource: 'kugou', resolvedId: 'new-id', resolvedLyricId: 'new-lyric',
      resolvedSongMeta: matched,
    });
    expect(getLyricRequest(song, runtime.refs.lyricBindings.current.get('kuwo:original-id'))).toEqual({
      id: 'new-id', source: 'kugou', songMeta: matched,
    });
  });

  it('没有候选元数据时不把原平台专属标识交给新平台', () => {
    const song = { ...originalSong, urlId: 'old-url', lyricId: 'old-lyric', picId: 'old-pic',
      hash: 'old-hash', albumId: 'old-album', qualityHashes: { flac: { hash: 'old-flac' } } };
    const request = getLyricRequest(song, { source: 'qq', id: 'new-id' })!;
    expect(request.songMeta).toEqual({
      name: song.name, artist: song.artist, album: song.album, lyricId: undefined, picId: undefined,
    });
    expect(getLyricRequest(song, { source: song.source, id: song.id })!.songMeta).toEqual(song);
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

  it('跨源录音更换时清掉旧逐字轨，延后元数据返回前不能显示原平台歌词', () => {
    const old = { ...originalSong, lrc: '[1000,1000](1000,1000,0)旧录音' };
    const runtime = createRuntime(old);
    runtime.refs.lyricMismatchNoticedKey.current = 'kuwo:original-id';
    const next = applyParsedMetadata(runtime, old, old, { url: 'https://audio.test/new.mp3', pic: '', lrc: '', resolvedSource: 'qq', resolvedId: 'new' });
    expect(next.lrc).toBe(''); expect(runtime.refs.queue.current[0].lrc).toBe('');
    expect(runtime.refs.lyricMismatchNoticedKey.current).toBeNull();
    expect(updateLyrics(runtime, old, { source: 'qq', id: 'new' }, '[00:01]新录音')).toBe(true);
    expect(runtime.refs.currentSong.current?.lrc).toBe('[00:01]新录音');
  });

  it('相同录音绑定仍按文本与质量补充，错误时标不能覆盖正确轨', () => {
    const lyrics = '[00:01]你好';
    const base = { ...originalSong, lrc: lyrics, durationSeconds: 120 };
    const runtime = createRuntime(base);
    runtime.refs.lyricBindings.current.set('kuwo:original-id', { source: 'kuwo', id: base.id });
    const result = applyParsedMetadata(runtime, base, base, { url: null, pic: '', lrc: '[1000,500](1000,500,0)你好',
      resolvedSource: 'kuwo', resolvedId: base.id });
    expect(result.lrc).toContain('(1000,500,0)');
    const overrun = '[1000,150000](1000,150000,0)你好';
    expect(updateLyrics(runtime, base, { source: 'kuwo', id: base.id }, overrun)).toBe(false);
    runtime.refs.audio.current = { duration: NaN } as HTMLAudioElement; runtime.duration = 120;
    expect(updateLyrics(runtime, base, { source: 'kuwo', id: base.id }, overrun)).toBe(false);
  });
});
