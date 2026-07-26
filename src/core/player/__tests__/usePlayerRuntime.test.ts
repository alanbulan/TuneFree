// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { Song } from "../../types";
import { usePlayerRuntime } from "../usePlayerRuntime";

const song = (id: string): Song => ({
  id, source: "netease", name: `Song ${id}`, artist: "Artist", album: "Album",
});

describe("usePlayerRuntime commit entry points", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the queue ref and the queue state in sync through commitQueue", () => {
    const { result } = renderHook(() => usePlayerRuntime());
    const next = [song("1"), song("2")];

    act(() => {
      result.current.commitQueue(next);
      // ref 必须在同一个 tick 内就是最新值，后续调用方才能安全地读它。
      expect(result.current.refs.queue.current).toBe(next);
    });

    expect(result.current.queue).toBe(next);
    expect(result.current.refs.queue.current).toBe(next);
  });

  it("feeds the updater with the ref value so chained commits compose", () => {
    const { result } = renderHook(() => usePlayerRuntime());

    act(() => {
      result.current.commitQueue([song("1")]);
      result.current.commitQueue((previous) => [...previous, song("2")]);
      result.current.commitQueue((previous) => [...previous, song("3")]);
    });

    expect(result.current.queue.map((item) => item.id)).toEqual(["1", "2", "3"]);
    expect(result.current.refs.queue.current).toBe(result.current.queue);
  });

  it("ignores a commit that returns the identical reference", () => {
    const { result } = renderHook(() => usePlayerRuntime());
    const next = [song("1")];

    act(() => { result.current.commitQueue(next); });
    const committed = result.current.queue;

    act(() => { result.current.commitQueue((previous) => previous); });
    expect(result.current.queue).toBe(committed);
  });

  it("keeps the current song ref and state in sync through commitCurrentSong", () => {
    const { result } = renderHook(() => usePlayerRuntime());
    const target = song("42");

    act(() => {
      result.current.commitCurrentSong(target);
      expect(result.current.refs.currentSong.current).toBe(target);
    });
    expect(result.current.currentSong).toBe(target);

    act(() => { result.current.commitCurrentSong(null); });
    expect(result.current.currentSong).toBeNull();
    expect(result.current.refs.currentSong.current).toBeNull();
  });

  it("persists the queue without the fields that expire with the process", () => {
    const { result } = renderHook(() => usePlayerRuntime());

    act(() => {
      result.current.commitQueue([{ ...song("1"), url: "http://127.0.0.1:1/x", lrc: "[00:01]a" }]);
    });

    const raw = localStorage.getItem("tunefree_queue") || "";
    expect(raw).toContain("netease");
    expect(raw).not.toContain("127.0.0.1");
    expect(raw).not.toContain("00:01");
  });
});
