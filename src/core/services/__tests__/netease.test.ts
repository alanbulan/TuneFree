import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../proxy", async (original) => ({
  ...await original<typeof import('../proxy')>(), proxyFetchJson: vi.fn(),
}));

import { proxyFetchJson } from "../proxy";
import { fetchNeteaseLyrics, getNeteaseTopListDetail, getNeteaseTopLists, searchNetease } from "../netease";
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

describe('网易搜索和歌词降级边界', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('分页搜索标准化字段，有效空列表和错误响应分开处理', async () => {
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({ result: { songs: [{ id: 1, name: '歌', ar: [{ name: '歌手' }], al: { name: '专辑', picUrl: '//example.test/a.jpg' } }, { id: 2 }] } });
    const songs = await searchNetease('雨 夜', 2, 10); expect(songs[0]).toMatchObject({ id: '1', artist: '歌手', album: '专辑' }); expect(songs[1].artist).toBe('');
    expect(proxyFetchJson).toHaveBeenCalledWith(expect.stringContaining('offset=10&limit=10'), 8000, undefined);
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({ code: 200, result: { songCount: 0 } }); expect(await searchNetease('无', 1, 10)).toEqual([]);
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({ code: 500 }); await expect(searchNetease('错误', 1, 10)).rejects.toThrow('搜索响应不可用');
  });
  it('代理空响应可走直连，正文失败和旧接口无歌词返回空', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{"lrc":{"lyric":"[00:01]直连歌词\\n{bad"}}')).mockRejectedValueOnce(new Error('旧接口失败'));
    vi.stubGlobal('fetch', fetch); vi.mocked(proxyFetchJson).mockResolvedValue(null);
    expect(await fetchNeteaseLyrics('direct')).toContain('直连歌词');
    fetch.mockRejectedValue(new Error('offline')); expect(await fetchNeteaseLyrics('empty')).toBe('');
    vi.mocked(proxyFetchJson).mockRejectedValueOnce(new Error('proxy')); expect(await fetchNeteaseLyrics('failed')).toBe('');
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({}).mockResolvedValueOnce({ lrc: '[00:01]旧接口' }); expect(await fetchNeteaseLyrics('legacy')).toContain('旧接口');
  });
  it('重试耗尽后榜单返回空列表', async () => {
    vi.useFakeTimers(); vi.mocked(proxyFetchJson).mockResolvedValue(null);
    const pending = getNeteaseTopLists(); await vi.advanceTimersByTimeAsync(1260); expect(await pending).toEqual([]); expect(proxyFetchJson).toHaveBeenCalledTimes(4);
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

  it("removes recognized structured v1 credit lines from displayed lyrics", async () => {
    vi.mocked(proxyFetchJson).mockResolvedValueOnce({
      lrc: {
        lyric: '{"t":0,"c":[{"tx":"作词: "},{"tx":"周杰伦"}]}\n[00:23.97]半夜睡不着觉',
      },
      yrc: {
        lyric: '{"t":0,"c":[{"tx":"作词: "},{"tx":"周杰伦"}]}\n[24080,1000](24080,300,0)半(24380,300,0)夜(24680,400,0)睡不着觉',
      },
    });

    const lrc = await fetchNeteaseLyrics(5257138);
    const rows = parseLyrics(lrc);

    expect(lrc).not.toContain('{"t":0');
    expect(lrc).not.toContain("作词: 周杰伦");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("半夜睡不着觉");
    expect(rows[0].karaokeTime).toBeCloseTo(24.08, 3);
    expect(rows[0].words).toHaveLength(3);
  });

  it("removes known structured production and copyright credit variants", async () => {
    const credits = [
      "洛天依调校：某制作人",
      "项目统筹：某统筹",
      "总策划：某策划",
      "音乐营销：某团队",
      "出品人：某出品方",
      "音乐发行：某发行方",
      "词曲版权归属-op：某版权方",
      "词曲版权归属-sp：某版权方",
      "本歌曲已获得词曲正版授权",
      "【未经著作权人许可 不得翻唱翻录或使用】",
    ];
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: {
          lyric: [
            ...credits.map((text, index) => JSON.stringify({
              t: index * 1000,
              c: [{ tx: text }],
            })),
            '{"t":9500,"c":[{"tx":"旁白："},{"tx":"故事继续"}]}',
            "[00:11.00]第一句歌词",
          ].join("\n"),
        },
      })
      .mockResolvedValueOnce({ lrc: { lyric: "" } });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    credits.forEach((credit) => expect(lrc).not.toContain(credit));
    expect(rows.map((row) => row.text)).toEqual(["旁白：故事继续", "第一句歌词"]);
  });

  it("keeps unknown structured lines as timed lyrics", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: {
          lyric: '{"t":1500,"c":[{"tx":"旁白："},{"tx":"故事开始"}]}\n[00:03.00]第一句歌词',
        },
      })
      .mockResolvedValueOnce({ lrc: { lyric: "" } });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    expect(lrc).toContain("[00:01.500]旁白：故事开始");
    expect(rows.map((row) => row.text)).toEqual(["旁白：故事开始", "第一句歌词"]);
  });

  it("keeps ordinary LRC lines even when their text looks like a credit", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: { lyric: "[00:01.00]作词：周杰伦\n[00:03.00]第一句歌词" },
      })
      .mockResolvedValueOnce({ lrc: { lyric: "" } });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    expect(lrc).toContain("[00:01.00]作词：周杰伦");
    expect(rows.map((row) => row.text)).toEqual(["作词：周杰伦", "第一句歌词"]);
  });

  it("keeps ordinary LRC lines for extended credit and copyright text", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: {
          lyric: "[00:01.00]洛天依调校：某制作人\n[00:02.00]本歌曲已获得词曲正版授权\n[00:03.00]第一句歌词",
        },
      })
      .mockResolvedValueOnce({ lrc: { lyric: "" } });

    const lrc = await fetchNeteaseLyrics(123);
    const rows = parseLyrics(lrc);

    expect(rows.map((row) => row.text)).toEqual([
      "洛天依调校：某制作人",
      "本歌曲已获得词曲正版授权",
      "第一句歌词",
    ]);
  });

  it("falls back to legacy lyrics when v1 has no yrc", async () => {
    vi.mocked(proxyFetchJson)
      .mockResolvedValueOnce({
        lrc: { lyric: "[00:01.00]新版普通歌词" },
      })
      .mockResolvedValueOnce({
        lrc: { lyric: "[00:01.00]旧版普通歌词" },
        yrc: {
          lyric: "[1000,2400](1000,400,0)旧(1400,400,0)版(1800,400,0)普(2200,400,0)通(2600,400,0)歌(3000,400,0)词",
        },
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
      { start: 1.8, duration: 0.4, text: "普" },
      { start: 2.2, duration: 0.4, text: "通" },
      { start: 2.6, duration: 0.4, text: "歌" },
      { start: 3, duration: 0.4, text: "词" },
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
