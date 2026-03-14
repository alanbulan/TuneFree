import { Song, TopList } from "../types";
import { SELF_HOSTED_PROXY } from "./config";
import { getProxies, proxyFetchJson } from "./proxy";
import { fixUrl } from "./utils";

// ==============================
// 酷我音乐 直连接口
// 通过 CORS 代理直接调用酷我 API，不依赖 TuneHub 后端
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

/**
 * 酷我歌词获取：
 * 1. 优先使用 openapi/v1/www/lyric/getlyric（兼容性更好）
 * 2. 降级到 m.kuwo.cn/newh5/singles/songinfoandlrc（httpsStatus=1 防止 301 重定向）
 *
 * 歌词格式：将 lrclist 转换为标准 LRC 时间轴格式（[mm:ss.xx]text）。
 * @param id 歌曲 ID
 */
export const fetchKuwoLyrics = async (
  id: string | number,
): Promise<string> => {
  try {
    let lrcList: any[] | null = null;

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

    if (!Array.isArray(lrcList)) return "";

    return lrcList
      .map((l: any) => {
        const t = parseFloat(l.time || "0");
        const min = Math.floor(t / 60).toString().padStart(2, "0");
        const sec = (t % 60).toFixed(2).padStart(5, "0");
        return `[${min}:${sec}]${l.lineLyric || ""}`;
      })
      .join("\n");
  } catch {
    return "";
  }
};
