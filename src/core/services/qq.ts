import { Song, TopList } from "../types";
import { mergeLyricTracks } from "../utils/lyrics";
import { decryptQrc } from "qrc-decoder";
import { buildLocalServerHeaders, SELF_HOSTED_PROXY } from "./config";
import { createLinkedAbort, getProxies, throwIfAborted } from "./proxy";
import { fixUrl } from "./utils";

// ==============================
// QQ 音乐 直连接口
// 统一通过 u.y.qq.com/cgi-bin/musicu.fcg 端点（移动客户端标识 ct=11）
// 直接通过 CORS 代理调用
// ==============================

/** musicu.fcg 请求公共头（模拟移动客户端） */
const QQ_COMM = {
  ct: 11,
  cv: 1003006,
  v: 1003006,
  os_ver: "12",
  phonetype: 0,
  buildnum: 166,
  tmeLoginType: 2,
} as const;

const MUSICU_URL = "https://u.y.qq.com/cgi-bin/musicu.fcg";

const decodeQQBase64 = (value: unknown): string => {
  if (typeof value !== "string" || !value) return "";

  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
};

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

const extractQrcLyricContent = (xml: string): string => {
  const content = xml.match(/\bLyricContent="([\s\S]*?)"\s*\/?>/)?.[1];
  return content ? decodeXmlEntities(content) : xml;
};

const decodeQQEncryptedQrc = (value: unknown): string => {
  if (typeof value !== "string" || !value) return "";

  try {
    if (!/^[a-fA-F0-9]+$/.test(value) || value.length % 16 !== 0) return "";
    const decrypted = decryptQrc(value);
    return decrypted ? extractQrcLyricContent(decrypted) : "";
  } catch {
    return "";
  }
};

/**
 * 通用 QQ 音乐 musicu.fcg 请求封装。
 * 自动包裹 comm 头，通过代理列表轮询，返回 data.req.data（code=0 时）。
 * 失败或 code !== 0 时返回 null。
 *
 * @param reqBody  req 字段内容（module、method、param）
 */
export const qqMusicuFetch = async (
  reqBody: any,
  signal?: AbortSignal,
): Promise<any> => {
  const body = {
    comm: QQ_COMM,
    req: reqBody,
  };
  const proxies = getProxies();

  for (const proxy of proxies) {
    const linked = createLinkedAbort(signal, 8000);
    try {
      const finalUrl = `${proxy}${encodeURIComponent(MUSICU_URL)}`;
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(isSelfProxy ? buildLocalServerHeaders() : {}),
        },
        body: JSON.stringify(body),
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
        signal: linked.signal,
      });

      const data = await resp.json();
      if (data?.req?.code === 0) return data.req.data;
    } catch {
      throwIfAborted(signal);
      /* 继续下一个代理 */
    } finally {
      linked.cleanup();
    }
  }

  return null;
};

// ==============================
// 搜索
// ==============================

/**
 * QQ 音乐搜索：使用 musicu.fcg DoSearchForQQMusicDesktop（移动客户端标识）。
 * 返回标准化的 Song 列表，封面通过 albumMid 构造高清 URL。
 *
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始）
 * @param limit   每页数量
 */
export const searchQQ = async (
  keyword: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const data = await qqMusicuFetch({
    method: "DoSearchForQQMusicDesktop",
    module: "music.search.SearchCgiService",
    param: { query: keyword, page_num: page, num_per_page: limit },
  }, signal);

  const songs = data?.body?.song?.list;
  if (!songs || !Array.isArray(songs) || songs.length === 0) return [];

  return songs.map((s: any) => ({
    id: s.mid || String(s.id),
    lyricId: s.id ? String(s.id) : undefined,
    name: s.name || "",
    artist: s.singer?.map((si: any) => si.name).join(", ") || "",
    album: s.album?.name || "",
    pic: s.album?.mid
      ? fixUrl(
          `https://y.gtimg.cn/music/photo_new/T002R500x500M000${s.album.mid}.jpg`,
        )
      : "",
    source: "qq" as const,
  }));
};

// ==============================
// 排行榜
// ==============================

/**
 * QQ 音乐榜单列表：通过 musicToplist.ToplistInfoServer GetAll 接口。
 * 响应包含 group 数组，每组有 toplist 子数组，展平后返回。
 */
export const getQQTopLists = async (): Promise<TopList[]> => {
  const data = await qqMusicuFetch({
    module: "musicToplist.ToplistInfoServer",
    method: "GetAll",
    param: {},
  });
  if (!data) return [];

  const groups: any[] = data.group || data.groupList || [];
  const allLists: TopList[] = [];

  for (const g of groups) {
    const toplists: any[] = g.toplist || g.topList || g.list || [];
    for (const item of toplists) {
      allLists.push({
        id: String(item.topId),
        name: item.title || item.name || "",
        updateFrequency: item.period || "",
        picUrl: fixUrl(
          item.frontPicUrl || item.headPicUrl || item.musichallPicUrl || "",
        ),
        coverImgUrl: fixUrl(
          item.frontPicUrl || item.headPicUrl || item.musichallPicUrl || "",
        ),
      });
    }
  }

  return allLists;
};

/**
 * QQ 音乐榜单详情：通过 musicToplist.ToplistInfoServer GetDetail 接口。
 * 获取指定榜单前 100 首歌曲（API 最大值）。
 *
 * @param topId 榜单 ID
 */
export const getQQTopListDetail = async (
  topId: string | number,
): Promise<Song[]> => {
  const data = await qqMusicuFetch({
    module: "musicToplist.ToplistInfoServer",
    method: "GetDetail",
    param: { topId: Number(topId), offset: 0, num: 100 },
  });
  if (!data) return [];

  // songInfoList 可能在 data.data 或直接在 data 下
  const songs: any[] =
    data.data?.songInfoList || data.songInfoList || [];

  if (!Array.isArray(songs) || songs.length === 0) return [];

  return songs.map((s: any) => ({
    id: s.mid || String(s.id || ""),
    lyricId: s.id ? String(s.id) : undefined,
    name: s.title || s.name || "",
    artist: s.singer?.map((si: any) => si.name).join(", ") || "",
    album: s.album?.title || s.album?.name || "",
    pic: s.album?.mid
      ? fixUrl(
          `https://y.gtimg.cn/music/photo_new/T002R500x500M000${s.album.mid}.jpg`,
        )
      : "",
    source: "qq" as const,
  }));
};

// ==============================
// 歌词
// ==============================

/**
 * QQ 音乐歌词：通过 musicu.fcg music.musichallSong.PlayLyricInfo 接口。
 * 返回 Base64 解码后的 LRC 文本（原文 + 译文，如有）。
 *
 * 注意：旧版 fcg_query_lyric_new 接口在 CORS 代理下返回 -1310 错误，
 * 必须使用此 musicu.fcg 统一接口。
 *
 * @param id 歌曲 MID（字母数字格式，如 "002Zkt5S2z8JZx"）
 */
export const fetchQQLyrics = async (
  id: string | number,
  signal?: AbortSignal,
): Promise<string> => {
  try {
    const numericId = /^\d+$/.test(String(id)) ? Number(id) : 0;
    const data = await qqMusicuFetch({
      module: "music.musichallSong.PlayLyricInfo",
      method: "GetPlayLyricInfo",
      param: {
        songMID: String(id),
        songID: numericId,
        crypt: 0,
        qrc: 1,
        trans: 1,
        roma: 1,
      },
    }, signal);

    if (!data) return "";

    const encryptedQrc = typeof data.qrc === "number" && data.qrc === 1;
    const karaoke = encryptedQrc ? decodeQQEncryptedQrc(data.lyric) : "";
    const main = karaoke || decodeQQBase64(data.lyric);
    const trans = decodeQQBase64(data.trans);
    const romanization = decodeQQBase64(data.roma);

    return mergeLyricTracks({
      main,
      translation: trans,
      romanization,
      karaoke,
      source: "qq",
    });
  } catch {
    throwIfAborted(signal);
    return "";
  }
};
