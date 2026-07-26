// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../../types";
import { PARSED_SONG_CACHE_TTL_MS } from "../playerUtils";
import type { ParsedSongData } from "../types";
import { useSongResolver } from "../useSongResolver";
import { abortError, createRuntimeDouble, song, type RuntimeDouble } from "./playerTestDoubles";

const api = vi.hoisted(() => ({ parseSongFull: vi.fn() }));
const offline = vi.hoisted(() => ({ resolveOfflinePlayback: vi.fn() }));

vi.mock("../../services/api", () => ({ parseSongFull: api.parseSongFull }));
vi.mock("../../services/offlineDownloads", () => ({
  resolveOfflinePlayback: offline.resolveOfflinePlayback,
}));

const parsed = (id: string, patch: Partial<ParsedSongData> = {}): ParsedSongData => ({
  url: `https://cdn.example.com/${id}.mp3`,
  lrc: `[00:01.00]${id}`,
  pic: "",
  resolvedSource: "netease",
  resolvedId: id,
  resolvedLyricId: id,
  ...patch,
});

const mountResolver = (double: RuntimeDouble) =>
  renderHook(() => useSongResolver(double.runtime)).result;

const flush = async (times = 4) => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

describe("useSongResolver 解析缓存", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    api.parseSongFull.mockReset();
    offline.resolveOfflinePlayback.mockReset();
    offline.resolveOfflinePlayback.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("在 TTL 内复用缓存，过期后重新解析", async () => {
    const target = song("a");
    const double = createRuntimeDouble({ queue: [target] });
    api.parseSongFull.mockResolvedValue(parsed("a"));
    const resolver = mountResolver(double);

    const first = await resolver.current.resolveParsedSong(target, "320k");
    expect(first.parsed?.url).toBe("https://cdn.example.com/a.mp3");
    expect(first.cacheKey).toBe("netease:a:320k");

    await resolver.current.resolveParsedSong(target, "320k");
    expect(api.parseSongFull).toHaveBeenCalledTimes(1);

    vi.setSystemTime(1_700_000_000_000 + PARSED_SONG_CACHE_TTL_MS + 1);
    await resolver.current.resolveParsedSong(target, "320k");
    expect(api.parseSongFull).toHaveBeenCalledTimes(2);
  });

  it("forceRefresh 跳过缓存并重新写入", async () => {
    const target = song("a");
    const double = createRuntimeDouble({ queue: [target] });
    api.parseSongFull.mockResolvedValue(parsed("a"));
    const resolver = mountResolver(double);

    await resolver.current.resolveParsedSong(target, "320k");
    await resolver.current.resolveParsedSong(target, "320k", { forceRefresh: true });
    expect(api.parseSongFull).toHaveBeenCalledTimes(2);

    await resolver.current.resolveParsedSong(target, "320k");
    expect(api.parseSongFull).toHaveBeenCalledTimes(2);
  });

  it("按音质分桶缓存，不同音质互不复用", async () => {
    const target = song("a");
    const double = createRuntimeDouble({ queue: [target] });
    api.parseSongFull.mockResolvedValue(parsed("a"));
    const resolver = mountResolver(double);

    await resolver.current.resolveParsedSong(target, "320k");
    const flac = await resolver.current.resolveParsedSong(target, "flac");
    expect(api.parseSongFull).toHaveBeenCalledTimes(2);
    expect(flac.cacheKey).toBe("netease:a:flac");
  });

  it("没有播放地址的结果不进缓存", async () => {
    const target = song("a");
    const double = createRuntimeDouble({ queue: [target] });
    api.parseSongFull.mockResolvedValue(parsed("a", { url: "" }));
    const resolver = mountResolver(double);

    await resolver.current.resolveParsedSong(target, "320k");
    await resolver.current.resolveParsedSong(target, "320k");
    expect(api.parseSongFull).toHaveBeenCalledTimes(2);
    expect(double.refs.parsedSongCache.current.size).toBe(0);
  });

  it("命中本地下载时完全跳过网络解析", async () => {
    const target = song("a");
    const double = createRuntimeDouble({ queue: [target] });
    offline.resolveOfflinePlayback.mockResolvedValue({
      url: "asset://local/a.flac", lrc: "[00:01.00]本地", pic: "",
    });
    const resolver = mountResolver(double);

    const result = await resolver.current.resolveParsedSong(target, "flac");
    expect(result.parsed?.url).toBe("asset://local/a.flac");
    expect(result.cacheKey).toBeNull();
    expect(api.parseSongFull).not.toHaveBeenCalled();
  });

  it("取消导致的失败原样抛出，不当作解析失败", async () => {
    const target = song("a");
    const double = createRuntimeDouble({ queue: [target] });
    api.parseSongFull.mockRejectedValue(abortError());
    const resolver = mountResolver(double);

    await expect(resolver.current.resolveParsedSong(target, "320k"))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(double.refs.parsedSongCache.current.size).toBe(0);
  });
});

describe("useSongResolver 预加载", () => {
  beforeEach(() => {
    api.parseSongFull.mockReset();
    offline.resolveOfflinePlayback.mockReset();
    offline.resolveOfflinePlayback.mockResolvedValue(null);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("同一个目标只预解析一次，音质变化后才重新预解析", async () => {
    const first = song("a");
    const next = song("b");
    const double = createRuntimeDouble({ queue: [first, next] });
    api.parseSongFull.mockResolvedValue(parsed("b"));
    const resolver = mountResolver(double);

    resolver.current.preloadNextSong(first);
    resolver.current.preloadNextSong(first);
    await flush();
    expect(api.parseSongFull).toHaveBeenCalledTimes(1);

    double.refs.audioQuality.current = "flac";
    resolver.current.preloadNextSong(first);
    await flush();
    expect(api.parseSongFull).toHaveBeenCalledTimes(2);
    expect(api.parseSongFull.mock.calls[1][2]).toBe("flac");
  });

  it("预加载结果写回队列，且重复补丁不制造新的队列引用", async () => {
    const first = song("a");
    const next = song("b");
    const double = createRuntimeDouble({ queue: [first, next] });
    api.parseSongFull.mockResolvedValue(parsed("b"));
    const resolver = mountResolver(double);

    resolver.current.preloadNextSong(first);
    await flush();
    expect(double.queueWrites()).toBe(1);
    expect(double.refs.queue.current[1]).toMatchObject({
      id: "b", url: "https://cdn.example.com/b.mp3", lrc: "[00:01.00]b",
    });

    // 第二轮补丁不带来任何字段变化，必须返回原引用，否则会触发 setQueue → effect → 再预加载。
    double.refs.preloadedResolutionKey.current = null;
    resolver.current.preloadNextSong(first);
    await flush();
    expect(double.queueWrites()).toBe(1);
  });

  it("切换预加载目标时中止上一个预加载请求", async () => {
    const queue: Song[] = [song("a"), song("b"), song("c")];
    const double = createRuntimeDouble({ queue });
    api.parseSongFull.mockImplementation(() => new Promise(() => {}));
    const resolver = mountResolver(double);

    resolver.current.preloadNextSong(queue[0]);
    await flush();
    const firstController = double.refs.preloadAbort.current;
    expect(firstController?.signal.aborted).toBe(false);

    double.refs.preloadedResolutionKey.current = null;
    resolver.current.preloadNextSong(queue[1]);
    await flush();
    expect(firstController?.signal.aborted).toBe(true);
    expect(double.refs.preloadAbort.current).not.toBe(firstController);
  });

  it("预加载失败后释放键位，允许下次重试", async () => {
    const first = song("a");
    const double = createRuntimeDouble({ queue: [first, song("b")] });
    api.parseSongFull.mockRejectedValue(new Error("上游 502"));
    const resolver = mountResolver(double);

    resolver.current.preloadNextSong(first);
    await flush();
    expect(double.refs.preloadedResolutionKey.current).toBeNull();

    api.parseSongFull.mockResolvedValue(parsed("b"));
    resolver.current.preloadNextSong(first);
    await flush();
    expect(double.refs.queue.current[1]).toMatchObject({ url: "https://cdn.example.com/b.mp3" });
  });

  it("队列只剩当前歌曲时不做预加载", async () => {
    const only = song("a");
    const double = createRuntimeDouble({ queue: [only] });
    const resolver = mountResolver(double);

    resolver.current.preloadNextSong(only);
    await flush();
    expect(api.parseSongFull).not.toHaveBeenCalled();
    expect(double.refs.preloadedResolutionKey.current).toBeNull();
  });
});
