// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Song } from "../../types";
import { useQueueControls } from "../useQueueControls";
import { createRuntimeDouble, song, type RuntimeDouble } from "./playerTestDoubles";

interface Harness {
  double: RuntimeDouble;
  preloadNextSong: ReturnType<typeof vi.fn>;
  playSong: ReturnType<typeof vi.fn>;
  mount: () => { rerender: () => void; result: { current: ReturnType<typeof useQueueControls> } };
}

const createHarness = (queue: Song[], currentSong: Song | null): Harness => {
  const double = createRuntimeDouble({ queue, currentSong });
  double.runtime.currentSong = currentSong;
  double.runtime.queue = queue;
  double.runtime.isPlaying = true;

  const preloadNextSong = vi.fn();
  const playSong = vi.fn(() => Promise.resolve());
  double.refs.playSong.current = playSong;

  const audio = {
    updateMediaSession: vi.fn(),
    updateCurrentTimeState: vi.fn(),
    updatePositionState: vi.fn(),
  } as unknown as Parameters<typeof useQueueControls>[1];
  const playback = {
    resumePlayback: vi.fn(() => Promise.resolve()),
    pausePlayback: vi.fn(),
    seek: vi.fn(),
  } as unknown as Parameters<typeof useQueueControls>[2];
  const recommendation = {
    logEarlySkipIfNeeded: vi.fn(),
    startPlaybackSession: vi.fn(),
  } as unknown as Parameters<typeof useQueueControls>[3];
  const resolver = {
    preloadNextSong,
    resolveParsedSong: vi.fn(),
    getParsedSongCacheKey: vi.fn(),
  } as unknown as Parameters<typeof useQueueControls>[4];

  const mount = () => {
    const view = renderHook(() =>
      useQueueControls(double.runtime, audio, playback, recommendation, resolver));
    return { rerender: () => view.rerender(), result: view.result };
  };

  return { double, preloadNextSong, playSong, mount };
};

describe("useQueueControls 预加载副作用", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("队列引用变化不再级联触发预加载", () => {
    const first = song("a");
    const second = song("b");
    const harness = createHarness([first, second], first);
    const { rerender } = harness.mount();

    expect(harness.preloadNextSong).toHaveBeenCalledTimes(1);

    // 预加载成功后必然 patch 队列；这个新引用不得把 effect 再点一次。
    for (const url of ["https://cdn/b1.mp3", "https://cdn/b2.mp3", "https://cdn/b3.mp3"]) {
      const patched = [first, { ...second, url }];
      harness.double.runtime.queue = patched;
      harness.double.refs.queue.current = patched;
      act(() => rerender());
    }
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(1);
  });

  it("换歌、音质与播放状态变化才重新预加载", () => {
    const first = song("a");
    const second = song("b");
    const harness = createHarness([first, second], first);
    const { rerender } = harness.mount();
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(1);

    harness.double.runtime.currentSong = second;
    harness.double.refs.currentSong.current = second;
    act(() => rerender());
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(2);
    expect(harness.preloadNextSong).toHaveBeenLastCalledWith(second);

    harness.double.runtime.audioQuality = "flac";
    act(() => rerender());
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(3);

    harness.double.runtime.isPlaying = false;
    act(() => rerender());
    expect(harness.preloadNextSong).toHaveBeenCalledTimes(3);
  });
});

describe("useQueueControls 随机播放导航", () => {
  it("随机模式下的上一首回到刚刚播过的那一首", () => {
    const queue = Array.from({ length: 8 }, (_, index) => song(String(index + 1)));
    const harness = createHarness(queue, queue[0]);
    harness.double.refs.playMode.current = "shuffle";
    harness.double.audio.currentTime = 0;
    const { result } = harness.mount();

    act(() => result.current.playNext(true));
    const calls = harness.playSong.mock.calls;
    const played = calls[calls.length - 1]?.[0] as Song;
    expect(played).toBeDefined();
    expect(played.id).not.toBe("1");

    harness.double.refs.currentSong.current = played;
    act(() => result.current.playPrev());
    const afterPrev = harness.playSong.mock.calls;
    expect(afterPrev[afterPrev.length - 1]?.[0]).toMatchObject({ id: "1" });
  });

  it("播放超过 3 秒时上一首只回到开头", () => {
    const queue = Array.from({ length: 4 }, (_, index) => song(String(index + 1)));
    const harness = createHarness(queue, queue[2]);
    harness.double.audio.currentTime = 12;
    const { result } = harness.mount();

    act(() => result.current.playPrev());
    expect(harness.playSong).not.toHaveBeenCalled();
    expect(harness.double.audio.currentTime).toBe(0);
  });

  it("addToQueue 去重且不产生多余的队列写入", () => {
    const first = song("a");
    const harness = createHarness([first], first);
    const { result } = harness.mount();
    const writesBefore = harness.double.queueWrites();

    act(() => result.current.addToQueue(first));
    expect(harness.double.queueWrites()).toBe(writesBefore);

    act(() => result.current.addToQueue(song("z")));
    expect(harness.double.queueWrites()).toBe(writesBefore + 1);
    expect(harness.double.refs.queue.current).toHaveLength(2);
  });
});
