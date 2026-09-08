// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../../types";
import { executeSongPlayback, type SongPlaybackDependencies } from "../songPlaybackController";
import type { ParsedSongData, ParsedSongResolution } from "../types";
import {
  abortError,
  createRuntimeDouble,
  deferred,
  song,
  type Deferred,
  type RuntimeDouble,
} from "./playerTestDoubles";

vi.mock("../../services/api", () => ({
  getLyrics: vi.fn(() => Promise.resolve("")),
}));

const parsedFor = (id: string, patch: Partial<ParsedSongData> = {}): ParsedSongData => ({
  url: `https://cdn.example.com/${id}.mp3`,
  lrc: "[00:01.00]句子",
  pic: "",
  resolvedSource: "netease",
  resolvedId: id,
  resolvedLyricId: id,
  ...patch,
});

describe('音频播放失败的收敛', () => {
  it.each(['AbortError', 'NotAllowedError', 'NotSupportedError', '普通失败'])('%s 走对应恢复路径', async (kind) => {
    const h = createHarness(); h.double.audio.play.mockRejectedValueOnce(new DOMException('source failed', kind));
    const playback = startPlayback(h, song('a')); await flushMicrotasks(); h.pending[0].resolve({ parsed: parsedFor('a'), cacheKey: null }); await playback.done;
    if (kind === 'AbortError') { expect(h.runRecovery).not.toHaveBeenCalled(); expect(h.showPlayerNotice).not.toHaveBeenCalled(); }
    else if (kind === 'NotAllowedError') { expect(h.showPlayerNotice).toHaveBeenCalledWith(expect.stringContaining('再次点击'), 'warning'); expect(h.runRecovery).not.toHaveBeenCalled(); }
    else { expect(h.runRecovery).toHaveBeenCalledWith(expect.objectContaining({ trigger: 'playRejected', canRetryWithoutCors: true })); h.runRecovery.mock.calls[0][0].onGiveUp(); expect(h.clearActiveAudioSource).toHaveBeenCalled(); expect(h.showPlayerNotice).toHaveBeenCalledWith('播放失败，请稍后再试', 'error'); }
  });
  it('CORS 策略变化重建元素，上下文恢复失败不产生未处理拒绝', async () => {
    const h = createHarness(); h.double.audio.crossOrigin = 'anonymous'; h.double.refs.isIOS.current = true;
    h.double.refs.audioContext.current = { state: 'suspended', resume: vi.fn().mockRejectedValue(new Error('resume')) } as unknown as AudioContext;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const playback = startPlayback(h, song('a')); await flushMicrotasks(); h.pending[0].resolve({ parsed: parsedFor('a'), cacheKey: null }); await playback.done;
    expect(h.dependencies.audio.createAudioElement).toHaveBeenCalledWith(false); expect(warn).toHaveBeenCalled(); warn.mockRestore();
  });
  it('没有可用地址且恢复耗尽时清理状态并给出提示', async () => {
    const h = createHarness(); const playback = startPlayback(h, song('a')); await flushMicrotasks();
    h.pending[0].resolve({ parsed: null, cacheKey: null }); await playback.done; h.runRecovery.mock.calls[0][0].onGiveUp();
    expect(h.clearActiveAudioSource).toHaveBeenCalled(); expect(h.double.setIsPlaying).toHaveBeenLastCalledWith(false); expect(h.showPlayerNotice).toHaveBeenCalledWith(expect.stringContaining('换源'), 'error');
  });
});

interface Harness {
  double: RuntimeDouble;
  dependencies: SongPlaybackDependencies;
  pending: Array<Deferred<ParsedSongResolution>>;
  signals: Array<AbortSignal | undefined>;
  resolveParsedSong: ReturnType<typeof vi.fn>;
  preloadNextSong: ReturnType<typeof vi.fn>;
  runRecovery: ReturnType<typeof vi.fn>;
  clearActiveAudioSource: ReturnType<typeof vi.fn>;
  resetPlaybackState: ReturnType<typeof vi.fn>;
  playNextRecommendationAfterFailure: ReturnType<typeof vi.fn>;
  evictActiveParsedSong: ReturnType<typeof vi.fn>;
  showPlayerNotice: ReturnType<typeof vi.fn>;
}

const createHarness = (options: Parameters<typeof createRuntimeDouble>[0] = {}): Harness => {
  const double = createRuntimeDouble(options);
  const pending: Array<Deferred<ParsedSongResolution>> = [];
  const signals: Array<AbortSignal | undefined> = [];

  const resolveParsedSong = vi.fn((
    _song: Song,
    _quality: string,
    resolveOptions?: { signal?: AbortSignal },
  ) => {
    signals.push(resolveOptions?.signal);
    const slot = deferred<ParsedSongResolution>();
    pending.push(slot);
    return slot.promise;
  });
  const preloadNextSong = vi.fn();
  const runRecovery = vi.fn();
  const clearActiveAudioSource = vi.fn();
  const resetPlaybackState = vi.fn();
  const playNextRecommendationAfterFailure = vi.fn(() => false);
  const evictActiveParsedSong = vi.fn();
  const showPlayerNotice = vi.fn();

  const dependencies = {
    runtime: double.runtime,
    audio: {
      updateMediaSession: vi.fn(),
      updateCurrentTimeState: vi.fn(),
      updatePositionState: vi.fn(),
      syncPlaybackTime: vi.fn(),
      createAudioElement: vi.fn(),
      initAudioContext: vi.fn(),
      clearActiveAudioSource,
    },
    controls: { resumePlayback: vi.fn(() => Promise.resolve()) },
    recovery: { runRecovery, evictActiveParsedSong, playNextRecommendationAfterFailure },
    recommendation: {
      startPlaybackSession: vi.fn(),
      resetPlaybackState,
      logPlaybackEvent: vi.fn(),
      logEarlySkipIfNeeded: vi.fn(),
      showPlayerNotice,
    },
    resolver: {
      resolveParsedSong,
      preloadNextSong,
      getParsedSongCacheKey: (target: Pick<Song, "id" | "source">, quality: string) =>
        `${target.source}:${target.id}:${quality}`,
    },
  } as unknown as SongPlaybackDependencies;

  return {
    double, dependencies, pending, signals, resolveParsedSong, preloadNextSong,
    runRecovery, clearActiveAudioSource, resetPlaybackState,
    playNextRecommendationAfterFailure, evictActiveParsedSong, showPlayerNotice,
  };
};

/** `executeSongPlayback` 在调用解析器前有若干个 await，先把微任务放空再操作 deferred。 */
const flushMicrotasks = async (times = 4) => {
  for (let index = 0; index < times; index += 1) await Promise.resolve();
};

/** 启动播放但不等它结束，只把微任务放空到解析器已被调用。 */
const startPlayback = (harness: Harness, target: Song): { done: Promise<void> } => ({
  done: executeSongPlayback(harness.dependencies, target),
});

describe("executeSongPlayback 竞态与取消", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("丢弃被新请求取代的旧解析结果", async () => {
    const first = song("a");
    const second = song("b");
    const harness = createHarness({ queue: [first, second] });

    const firstPlay = startPlayback(harness, first);
    await flushMicrotasks();
    const secondPlay = startPlayback(harness, second);
    await flushMicrotasks();

    // 旧请求后完成：它的解析结果必须被完全丢弃，不能覆盖新歌的音频源。
    harness.pending[1].resolve({ parsed: parsedFor("b"), cacheKey: "netease:b:320k" });
    await secondPlay.done;
    harness.pending[0].resolve({ parsed: parsedFor("a"), cacheKey: "netease:a:320k" });
    await firstPlay.done;

    expect(harness.double.audio.src).toBe("https://cdn.example.com/b.mp3");
    expect(harness.double.audio.play).toHaveBeenCalledTimes(1);
    expect(harness.resetPlaybackState).toHaveBeenCalledTimes(1);
    expect(harness.resetPlaybackState.mock.calls[0][0]).toMatchObject({ id: "b" });
    expect(harness.double.refs.currentSong.current).toMatchObject({ id: "b" });
  });

  it("快速切歌时前一个 AbortController 被真正 abort", async () => {
    const first = song("a");
    const second = song("b");
    const harness = createHarness({ queue: [first, second] });

    const firstPlay = startPlayback(harness, first);
    await flushMicrotasks();
    expect(harness.signals[0]?.aborted).toBe(false);

    const secondPlay = startPlayback(harness, second);
    await flushMicrotasks();
    expect(harness.signals[0]?.aborted).toBe(true);
    expect(harness.signals[1]?.aborted).toBe(false);
    expect(harness.signals[0]).not.toBe(harness.signals[1]);

    harness.pending[0].reject(abortError());
    harness.pending[1].resolve({ parsed: parsedFor("b"), cacheKey: null });
    await Promise.all([firstPlay.done, secondPlay.done]);
  });

  it("解析被取消时不走失败恢复，也不清空音频源", async () => {
    const target = song("a");
    const harness = createHarness({ queue: [target] });

    const playback = startPlayback(harness, target);
    await flushMicrotasks();
    harness.pending[0].reject(abortError());
    await playback.done;

    expect(harness.runRecovery).not.toHaveBeenCalled();
    expect(harness.evictActiveParsedSong).not.toHaveBeenCalled();
    expect(harness.clearActiveAudioSource).not.toHaveBeenCalled();
    expect(harness.double.setIsPlaying).not.toHaveBeenCalledWith(true);
  });

  it("解析真正失败时收敛到失败恢复路径", async () => {
    const target = song("a");
    const harness = createHarness({ queue: [target] });

    const playback = startPlayback(harness, target);
    await flushMicrotasks();
    harness.pending[0].reject(new Error("解析失败"));
    await playback.done;

    expect(harness.double.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(harness.evictActiveParsedSong).toHaveBeenCalledTimes(1);
    expect(harness.playNextRecommendationAfterFailure).toHaveBeenCalledTimes(1);
    expect(harness.clearActiveAudioSource).toHaveBeenCalledTimes(1);
  });

  it("解析成功但没有播放地址时交给 missingUrl 恢复分支", async () => {
    const target = song("a");
    const harness = createHarness({ queue: [target] });

    const playback = startPlayback(harness, target);
    await flushMicrotasks();
    harness.pending[0].resolve({
      parsed: parsedFor("a", { url: "" }), cacheKey: "netease:a:320k",
    });
    await playback.done;

    expect(harness.double.audio.play).not.toHaveBeenCalled();
    expect(harness.runRecovery).toHaveBeenCalledTimes(1);
    expect(harness.runRecovery.mock.calls[0][0]).toMatchObject({ trigger: "missingUrl" });
  });

  it("成功播放后预加载下一首并写回解析结果", async () => {
    const target = song("a");
    const harness = createHarness({ queue: [target, song("b")] });

    const playback = startPlayback(harness, target);
    await flushMicrotasks();
    harness.pending[0].resolve({ parsed: parsedFor("a"), cacheKey: "netease:a:320k" });
    await playback.done;

    expect(harness.double.audio.src).toBe("https://cdn.example.com/a.mp3");
    expect(harness.double.setIsPlaying).toHaveBeenCalledWith(true);
    expect(harness.double.setIsLoading).toHaveBeenLastCalledWith(false);
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(1);
    expect(harness.double.refs.activeParsedCacheKey.current).toBe("netease:a:320k");
    expect(harness.double.refs.queue.current[0]).toMatchObject({
      id: "a", url: "https://cdn.example.com/a.mp3",
    });
  });

  it("重复播放当前正在放的歌不会新开解析请求", async () => {
    const target = song("a");
    const harness = createHarness({ queue: [target], currentSong: target });
    harness.double.audio.src = "https://cdn.example.com/a.mp3";
    harness.double.audio.paused = false;

    await executeSongPlayback(harness.dependencies, target);

    expect(harness.resolveParsedSong).not.toHaveBeenCalled();
    expect(harness.double.refs.playRequestId.current).toBe(0);
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(1);
  });
});
