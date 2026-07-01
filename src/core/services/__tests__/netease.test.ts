import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../proxy", () => ({
  proxyFetchJson: vi.fn(),
}));

import { proxyFetchJson } from "../proxy";
import { fetchNeteaseLyrics, getNeteaseTopListDetail, getNeteaseTopLists } from "../netease";
import { parseLyrics } from "../../utils/lyrics";

describe("netease top lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries when top list response is temporarily invalid", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        list: [
          {
            id: 3778678,
            name: "热歌榜",
            updateFrequency: "每日更新",
            coverImgUrl: "https://example.com/cover.jpg",
          },
        ],
      });

    const promise = getNeteaseTopLists();
    await vi.advanceTimersByTimeAsync(180);
    const lists = await promise;

    expect(proxyFetchJson).toHaveBeenCalledTimes(2);
    expect(lists).toEqual([
      {
        id: "3778678",
        name: "热歌榜",
        updateFrequency: "每日更新",
        picUrl: "https://example.com/cover.jpg",
        coverImgUrl: "https://example.com/cover.jpg",
      },
    ]);
  });

  it("retries when top list detail response is temporarily invalid", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        playlist: {
          tracks: [
            {
              id: 1,
              name: "Song",
              ar: [{ name: "Artist" }],
              al: { name: "Album", picUrl: "https://example.com/song.jpg" },
            },
          ],
        },
      });

    const promise = getNeteaseTopListDetail(3778678);
    await vi.advanceTimersByTimeAsync(180);
    const songs = await promise;

    expect(proxyFetchJson).toHaveBeenCalledTimes(2);
    expect(songs).toEqual([
      {
        id: "1",
        name: "Song",
        artist: "Artist",
        album: "Album",
        pic: "https://example.com/song.jpg",
        source: "netease",
      },
    ]);
  });
});

describe("netease lyrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses lyric v1 yrc when available", async () => {
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({
      lrc: { lyric: "[00:01.00]你好" },
      yrc: { lyric: "[1000,800](1000,400,0)你(1400,400,0)好" },
    });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    expect(proxyFetchJson).toHaveBeenCalledTimes(1);
    expect(vi.mocked(proxyFetchJson).mock.calls[0][0]).toContain("/api/song/lyric/v1");
    expect(lrc).toContain("[tunefree:karaoke]");
    expect(rows[0].words).toEqual([
      { start: 1, duration: 0.4, text: "你" },
      { start: 1.4, duration: 0.4, text: "好" },
    ]);
  });

  it("falls back to legacy lyrics when v1 has no yrc", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: { lyric: "[00:01.00]新版普通歌词" },
      })
      .mockResolvedValueOnce({
        lrc: { lyric: "[00:01.00]旧版普通歌词" },
        yrc: { lyric: "[1000,800](1000,400,0)旧(1400,400,0)版" },
      });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    expect(proxyFetchJson).toHaveBeenCalledTimes(2);
    expect(vi.mocked(proxyFetchJson).mock.calls[0][0]).toContain("/api/song/lyric/v1");
    expect(vi.mocked(proxyFetchJson).mock.calls[1][0]).toContain("/api/song/lyric?");
    expect(rows[0].text).toBe("旧版普通歌词");
    expect(rows[0].words).toEqual([
      { start: 1, duration: 0.4, text: "旧" },
      { start: 1.4, duration: 0.4, text: "版" },
    ]);
  });

  it("keeps v1 plain lyrics when neither endpoint has yrc", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: { lyric: "[00:01.00]新版普通歌词" },
      })
      .mockResolvedValueOnce({
        lrc: { lyric: "" },
      });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    expect(proxyFetchJson).toHaveBeenCalledTimes(2);
    expect(lrc).toBe("[00:01.00]新版普通歌词");
    expect(rows[0].text).toBe("新版普通歌词");
    expect(rows[0].words).toBeUndefined();
  });
});
