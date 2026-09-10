import { Song, TopList } from "../types";
import { mergeLyricTracks } from "../utils/lyrics";
import { inflate } from "pako";
import { SELF_HOSTED_PROXY } from "./config";
import { getProxies, proxyFetchJson } from "./proxy";
import { fixUrl } from "./utils";

// ==============================
// 酷我音乐 直连接口
// 通过 CORS 代理直接调用酷我 API
// ==============================

/**
 * 批量获取酷我歌曲封面（通过 artistpicserver 接口，并行请求）。
 * 旧版搜索 / 榜单 API 不返回封面，需单独补全。
 * 失败的单首封面不影响整体结果。
 * @param songs 待补全封面的歌曲列表
 */
export const batchFetchKuwoCovers = async (songs: Song[]): Promise<Song[]> => {
  if (songs.length === 0) return songs;
  const proxy = getProxies()[0]; // 只用最高优先级代理（自建代理）

  const coverPromises = songs.map(async (song) => {
    if (song.pic || !song.id) return song;
    try {
      const apiUrl = `http://artistpicserver.kuwo.cn/pic.web?corp=kuwo&type=rid_pic&pictype=500&size=500&rid=${song.id}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(`${proxy}${encodeURIComponent(apiUrl)}`, {
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const picUrl = (await resp.text()).trim();
      if (picUrl && picUrl.startsWith("http")) {
        return { ...song, pic: fixUrl(picUrl) };
      }
    } catch {
      /* 单首封面获取失败不影响整体 */
    }
    return song;
  });

  return Promise.all(coverPromises);
};

/**
 * 酷我搜索：旧版 search.kuwo.cn/r.s（无需 CSRF，稳定可用）。
 * 新版 v2 接口存在 CSRF Token 校验问题，暂不使用。
 * 旧版 API 返回单引号 dict 格式（非标准 JSON），需预处理后解析。
 * 搜索结果无封面，通过 batchFetchKuwoCovers 批量补全。
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始）
 * @param limit   每页数量
 */
export const searchKuwo = async (
  keyword: string,
  page: number,
  limit: number,
): Promise<Song[]> => {
  const pn = page - 1; // 旧版 API 页码从 0 开始
  const rawUrl = `http://search.kuwo.cn/r.s?all=${encodeURIComponent(keyword)}&ft=music&itemset=web_2013&pn=${pn}&rn=${limit}&encoding=utf8&rformat=json&moession=1&vkey=VKEY`;
  const proxies = getProxies();

  for (const proxy of proxies) {
    try {
      const finalUrl = `${proxy}${encodeURIComponent(rawUrl)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(finalUrl, {
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let text = await resp.text();
      // 旧版 kuwo API 返回单引号 dict，转换为标准 JSON
      text = text.replace(/'/g, '"');

      const data = JSON.parse(text);
      const list = data?.abslist;
      if (!list || !Array.isArray(list) || list.length === 0) continue;

      const songs: Song[] = list.map((s: any) => {
        const rid = String(s.MUSICRID || "").replace("MUSIC_", "");
        return {
          id: rid || String(s.DC_TARGETID || Math.random()),
          // 旧版 API 歌名含 &nbsp; HTML 实体，需清理
          name: (s.SONGNAME || s.NAME || "").replace(/&nbsp;/g, " ").trim(),
          artist: (s.ARTIST || "").replace(/&nbsp;/g, " ").trim(),
          album: (s.ALBUM || "").replace(/&nbsp;/g, " ").trim(),
          pic: "",
          source: "kuwo" as const,
        };
      });

      // 旧版 API 无封面，通过 artistpicserver 批量补全
      return batchFetchKuwoCovers(songs);
    } catch {
      /* 继续下一个代理 */
    }
  }

  return [];
};

// ==============================
// 酷我榜单
// ==============================

/**
 * 常用酷我排行榜硬编码列表（榜单 ID 稳定，封面通过 kbangserver 动态获取）。
 */
const KUWO_POPULAR_CHARTS: Array<{ id: string; name: string; pic: string }> = [
  { id: "93", name: "酷我飙升榜", pic: "" },
  { id: "17", name: "酷我新歌榜", pic: "" },
  { id: "16", name: "酷我热歌榜", pic: "" },
  { id: "158", name: "抖音热歌榜", pic: "" },
  { id: "284", name: "Billboard榜", pic: "" },
  { id: "264", name: "酷我民谣榜", pic: "" },
  { id: "145", name: "会员畅听榜", pic: "" },
];

/**
 * 酷我榜单列表：并行请求每个榜单的封面（kbangserver v9_pic2 字段），
 * 封面获取失败时降级为空字符串。
 */
export const getKuwoTopLists = async (): Promise<TopList[]> => {
  const chartsWithCovers = await Promise.all(
    KUWO_POPULAR_CHARTS.map(async (c) => {
      try {
        const data = await proxyFetchJson(
          `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&type=bang&data=content&id=${c.id}&pn=0&rn=1`,
        );
        const pic: string = data?.v9_pic2 || data?.pic || "";
        return { ...c, pic };
      } catch {
        return c;
      }
    }),
  );

  return chartsWithCovers.map((c) => ({
    id: c.id,
    name: c.name,
    updateFrequency: "每日更新",
    picUrl: fixUrl(c.pic),
    coverImgUrl: fixUrl(c.pic),
  }));
};

/**
 * 酷我榜单详情：kbangserver.kuwo.cn。
 * 返回前 30 首歌曲，封面通过 batchFetchKuwoCovers 批量补全。
 * @param id 榜单 ID
 */
export const getKuwoTopListDetail = async (
  id: string | number,
): Promise<Song[]> => {
  const data = await proxyFetchJson(
    `http://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=0&rn=30&type=bang&data=content&id=${id}`,
  );
  const list = data?.musiclist;
  if (!list || !Array.isArray(list)) return [];

  const songs: Song[] = list.map((s: any) => ({
    id: String(s.id || ""),
    name: s.name || "",
    artist: s.artist || "",
    album: s.album || "",
    pic: "",
    source: "kuwo" as const,
  }));

  // kbangserver 不返回封面，通过 artistpicserver 批量补全
  return batchFetchKuwoCovers(songs);
};

// ==============================
// 酷我歌词
// ==============================

/** newlyric 逐字歌词（lrcx）的异或密钥与请求指纹。 */
const KUWO_LRCX_KEY = new TextEncoder().encode("yeelion");

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};

const buildKuwoNewLyricToken = (id: string | number): string => {
  const rid = /^\d+$/.test(String(id)) ? `MUSIC_${id}` : String(id);
  const params = `user=313928,MUSIC_9.1.1.8_W6,kwmusic_web_6 (1).exe,KwMusic&requester=localhost&req=1&rid=${rid}&lrcx=1&olrc=1`;
  const input = new TextEncoder().encode(params);
  const output = new Uint8Array(input.length);

  for (let index = 0; index < input.length; index++) {
    output[index] = input[index] ^ KUWO_LRCX_KEY[index % KUWO_LRCX_KEY.length];
  }

  return bytesToBase64(output);
};

const findByteSequence = (bytes: Uint8Array, sequence: number[]): number => {
  for (let index = 0; index <= bytes.length - sequence.length; index++) {
    if (sequence.every((byte, offset) => bytes[index + offset] === byte)) {
      return index;
    }
  }
  return -1;
};

/** 响应是 HTTP 头 + gzip 的 base64，解压后再异或还原成 gb18030 文本。 */
const decryptKuwoLrcx = (payload: ArrayBuffer): string => {
  try {
    const bytes = new Uint8Array(payload);
    const separatorIndex = findByteSequence(bytes, [13, 10, 13, 10]);
    const body = separatorIndex >= 0 ? bytes.slice(separatorIndex + 4) : bytes;
    const base64Text = new TextDecoder("utf-8").decode(inflate(body));
    const content = base64ToBytes(base64Text.trim());

    for (let index = 0; index < content.length; index++) {
      content[index] ^= KUWO_LRCX_KEY[index % KUWO_LRCX_KEY.length];
    }

    return new TextDecoder("gb18030").decode(content);
  } catch {
    return "";
  }
};

/**
 * 把 lrcx 转成引擎认识的 QRC 逐字格式：[行起始ms,行时长ms](字起始ms,字时长ms,0)字……
 * k1 / k2 来自 [kuwo:八进制标记]，是恢复绝对时间的换算系数。
 */
const parseKuwoLrcxAsKaraoke = (lrcx: string): string => {
  const kuwoMarker = lrcx.match(/^\[kuwo:([0-7]+)\]/m)?.[1];
  if (!kuwoMarker) return "";

  const kuwo = parseInt(kuwoMarker, 8);
  const k1 = Math.floor(kuwo / 10);
  const k2 = kuwo % 10;
  if (!k1 || !k2) return "";

  const output: string[] = [];

  for (const rawLine of lrcx.split(/\r?\n/)) {
    const lineMatch = rawLine.trim().match(/^\[(\d+):(\d+)\.(\d+)\](.*)$/);
    if (!lineMatch) continue;

    const lineStart =
      Number(lineMatch[1]) * 60 * 1000 +
      Number(lineMatch[2]) * 1000 +
      Number(lineMatch[3].padEnd(3, "0").slice(0, 3));
    const content = lineMatch[4] || "";
    const words: Array<{ start: number; duration: number; text: string }> = [];

    for (const wordMatch of content.matchAll(/<(\d+),(-?\d+)>([^<]+)/g)) {
      const v1 = Number(wordMatch[1]);
      const v2 = Number(wordMatch[2]);
      const start = (v1 + v2) / (k1 * 2);
      const duration = (v1 - v2) / (k2 * 2);
      const text = wordMatch[3] || "";

      if (
        text &&
        Number.isFinite(start) &&
        Number.isFinite(duration) &&
        duration > 0
      ) {
        words.push({ start, duration, text });
      }
    }

    if (words.length === 0) continue;

    const lineDuration = Math.max(
      ...words.map((word) => word.start + word.duration),
    );
    const lyricText = words
      .map((word) => `(${Math.round(lineStart + word.start)},${Math.round(word.duration)},0)${word.text}`)
      .join("");
    output.push(`[${Math.round(lineStart)},${Math.round(lineDuration)}]${lyricText}`);
  }

  return output.join("\n");
};

const fetchKuwoLrcxKaraoke = async (
  id: string | number,
): Promise<string> => {
  const rawUrl = `http://newlyric.kuwo.cn/newlyric.lrc?${buildKuwoNewLyricToken(id)}`;
  const proxy = getProxies()[0];
  const isSelfProxy = proxy === SELF_HOSTED_PROXY;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(`${proxy}${encodeURIComponent(rawUrl)}`, {
      ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
      credentials: "omit",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!resp.ok) return "";

    return parseKuwoLrcxAsKaraoke(decryptKuwoLrcx(await resp.arrayBuffer()));
  } catch {
    return "";
  }
};

/**
 * 酷我歌词获取：
 * 1. 优先使用 openapi/v1/www/lyric/getlyric（兼容性更好）
 * 2. 降级到 m.kuwo.cn/newh5/singles/songinfoandlrc（httpsStatus=1 防止 301 重定向）
 * 3. 并行的 newlyric 逐字轨（lrcx）作为 karaoke 轨合并进去
 *
 * 逐行歌词转换成标准 LRC 时间轴格式（[mm:ss.xx]text）。
 * @param id 歌曲 ID
 */
export const fetchKuwoLyrics = async (
  id: string | number,
): Promise<string> => {
  try {
    let lrcList: any[] | null = null;
    // 逐字歌词与逐行歌词并行请求；主歌词先失败时避免这里成为 unhandled rejection。
    const karaokePromise = fetchKuwoLrcxKaraoke(id);
    karaokePromise.catch(() => {});

    // 优先：openapi 端点（兼容性更好）
    const openApiResp = await proxyFetchJson(
      `https://kuwo.cn/openapi/v1/www/lyric/getlyric?musicId=${id}`,
    );
    if (openApiResp?.data?.lrclist) {
      lrcList = openApiResp.data.lrclist;
    } else {
      // 降级：songinfoandlrc（httpsStatus=1 防止 301 重定向）
      const fallbackResp = await proxyFetchJson(
        `http://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${id}&httpsStatus=1`,
      );
      if (fallbackResp?.data?.lrclist) {
        lrcList = fallbackResp.data.lrclist;
      }
    }

    const main = Array.isArray(lrcList)
      ? lrcList.map((l: any) => {
        const t = parseFloat(l.time || "0");
        const min = Math.floor(t / 60).toString().padStart(2, "0");
        const sec = (t % 60).toFixed(2).padStart(5, "0");
        return `[${min}:${sec}]${l.lineLyric || ""}`;
      })
      .join("\n")
      : "";
    const karaoke = await karaokePromise;

    return mergeLyricTracks({ main, karaoke, source: "kuwo" });
  } catch {
    return "";
  }
};
