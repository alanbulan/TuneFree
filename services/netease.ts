import { Song, TopList } from "../types";
import { mergeLyricTracks } from "../utils/lyrics";
import { proxyFetchJson } from "./proxy";
import { normalizeMusicUrl } from "./utils";

// ==============================
// 网易云音乐 直连接口
// 通过 CORS 代理直接调用网易云 API
// ==============================

const getLyricText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { lyric?: unknown }).lyric === "string") {
    return (value as { lyric: string }).lyric;
  }
  return "";
};

const formatNeteaseLyricTime = (timeMs: number): string => {
  const safeTime = Math.max(0, Math.round(timeMs));
  const minutes = Math.floor(safeTime / 60_000);
  const seconds = Math.floor((safeTime % 60_000) / 1000);
  const milliseconds = safeTime % 1000;
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(milliseconds).padStart(3, "0")}]`;
};

/** 结构化歌词行：{t: 毫秒, c: [{tx: 词}]}。 */
const parseNeteaseStructuredLyricLine = (line: string): { timeMs: number; text: string } | null => {
  if (!line.startsWith("{")) return null;

  try {
    const payload = JSON.parse(line) as {
      t?: unknown;
      c?: Array<{ tx?: unknown }>;
    };
    if (typeof payload.t !== "number" || !Number.isFinite(payload.t) || !Array.isArray(payload.c)) return null;

    const text = payload.c
      .map((item) => typeof item?.tx === "string" ? item.tx : "")
      .join("")
      .trim();
    return text ? { timeMs: Number(payload.t), text } : null;
  } catch {
    return null;
  }
};

// 结构化歌词里夹带的制作人员署名，不属于歌词正文，必须剔除。
const NETEASE_STRUCTURED_CREDIT_LABEL = /^(?:(?:洛天依)?调校|(?:洛天依)?調校|作[词詞]|作曲|编曲|編曲|原唱|翻唱|演唱|制作人|製作人|制作|製作|监制|監製|统筹|統籌|项目统筹|項目統籌|总策划|總策劃|企划|企劃|音乐营销|音樂營銷|和声(?:编写|編寫)?|和聲(?:编写|編寫)?|配唱制作人|配唱製作人|吉他|贝斯|貝斯|鼓|钢琴|鋼琴|键盘|鍵盤|弦乐|弦樂|乐器|樂器|混音(?:工程师|工程師|工程)?|母带(?:工程师|工程師|处理|處理)?|录音(?:工程师|工程師|工程)?|錄音(?:工程师|工程師|工程)?|人声编辑|人聲編輯|音频编辑|音頻編輯|出品人?|發行人?|发行人?|音乐发行|音樂發行|版权|版權|授权|授權|词曲版权归属\s*[-—–]?\s*(?:OP\s*\/\s*SP|OP|SP)?|詞曲版權歸屬\s*[-—–]?\s*(?:OP\s*\/\s*SP|OP|SP)?|特别鸣谢|特別鳴謝|OP|SP|ISRC)(?=\s*[:：]|\s+)/i;

const NETEASE_STRUCTURED_CREDIT_NOTICE = /^(?:【|\[)?(?:本歌曲已获得词曲正版授权|本歌曲已獲得詞曲正版授權|未经著作权人许可|未經著作權人許可)(?:[，,。；;：:\s].*)?(?:】|\])?$/;

const isNeteaseStructuredCredit = (text: string): boolean =>
  NETEASE_STRUCTURED_CREDIT_LABEL.test(text) || NETEASE_STRUCTURED_CREDIT_NOTICE.test(text);

/**
 * 结构化行转回 LRC 时间标签。
 * includeStructuredLines=false 时整行丢弃（逐字轨只保留真正的逐字内容）。
 */
const normalizeNeteaseLyricTrack = (
  raw: string,
  includeStructuredLines: boolean,
): string => raw
  .split(/\r?\n/)
  .flatMap((line) => {
    const structured = parseNeteaseStructuredLyricLine(line.trim());
    if (!structured) return line;
    if (isNeteaseStructuredCredit(structured.text)) return [];
    if (!includeStructuredLines) return [];
    return `${formatNeteaseLyricTime(structured.timeMs)}${structured.text}`;
  })
  .join("\n")
  .trim();

const buildNeteaseLyricV1Url = (id: string | number): string =>
  `https://music.163.com/api/song/lyric/v1?id=${id}&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0`;

const buildNeteaseLyricLegacyUrl = (id: string | number): string =>
  `https://music.163.com/api/song/lyric?id=${id}&lv=-1&kv=-1&tv=-1&rv=-1&yv=-1&ytv=-1`;

const fetchNeteaseLyricJson = async (url: string): Promise<any> => {
  const proxied = await proxyFetchJson(url, 8000);
  if (proxied) return proxied;

  try {
    const resp = await fetch(url);
    return await resp.json();
  } catch {
    return null;
  }
};

const extractNeteaseLyricTracks = (data: any) => ({
  main: normalizeNeteaseLyricTrack(getLyricText(data?.lrc), true),
  translation: normalizeNeteaseLyricTrack(getLyricText(data?.tlyric), true),
  romanization: normalizeNeteaseLyricTrack(getLyricText(data?.romalrc), true),
  karaoke: normalizeNeteaseLyricTrack(
    getLyricText(data?.yrc) || getLyricText(data?.klyric),
    false,
  ),
});

const hasAnyLyricTrack = (tracks: ReturnType<typeof extractNeteaseLyricTracks>): boolean =>
  !!(tracks.main || tracks.translation || tracks.romanization || tracks.karaoke);

const mergeNeteaseLyricPayload = (tracks: ReturnType<typeof extractNeteaseLyricTracks>): string =>
  mergeLyricTracks({
    main: tracks.main,
    translation: tracks.translation,
    romanization: tracks.romanization,
    karaoke: tracks.karaoke,
    source: "netease",
  });

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 网易云接口主机优先级。
 *
 * Cloudflare 出口 IP 在 music.163.com 上会被风控验证墙（code -462
 * 「验证成功后，可进行下一步操作哦~」）拦掉大部分请求：实测榜单详情
 * /api/v6/playlist/detail 只有 1/10 次成功，同一路径走 interface 子域名
 * 10/10 成功，内容完全一致。按顺序尝试，任一成功即返回。
 */
export const NETEASE_API_HOSTS = [
  "https://interface.music.163.com",
  "https://interface3.music.163.com",
  "https://music.163.com",
] as const;

/** 榜单接口偶发触发风控或返回空结构，按指数退避重试。 */
const fetchNeteaseJsonWithRetry = async (
  path: string,
  isValid: (data: any) => boolean,
): Promise<any> => {
  const retryDelays = [180, 360];

  for (const host of NETEASE_API_HOSTS) {
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      const data = await proxyFetchJson(`${host}${path}`);
      if (isValid(data)) return data;
      if (attempt < retryDelays.length) {
        await wait(retryDelays[attempt]);
      }
    }
  }

  return null;
};

/**
 * 网易云搜索：cloudsearch/pc（未加密，支持分页）
 * @param keyword 搜索关键词
 * @param page    页码（从 1 开始）
 * @param limit   每页数量
 */
export const searchNetease = async (
  keyword: string,
  page: number,
  limit: number,
): Promise<Song[]> => {
  const offset = (page - 1) * limit;
  const url = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&limit=${limit}`;

  const data = await proxyFetchJson(url);
  const songs = data?.result?.songs;

  if (!Array.isArray(songs)) {
    // 明确的「零结果」是正常返回，其余情况必须抛出，否则会被误判成没有搜到。
    if (data?.code === 200 && data?.result?.songCount === 0) return [];
    throw new Error('网易云搜索响应不可用');
  }

  return songs.map((s: Record<string, unknown>) => {
    const ar = s.ar;
    const al = s.al;
    return {
      id: String(s.id),
      name: String(s.name ?? ""),
      artist: Array.isArray(ar) ? ar.map((a: Record<string, unknown>) => String(a.name ?? "")).join(", ") : "",
      album: typeof al === "object" && al !== null ? String((al as Record<string, unknown>).name ?? "") : "",
      pic: normalizeMusicUrl(typeof al === "object" && al !== null ? (al as Record<string, unknown>).picUrl as string : ""),
      source: "netease" as const,
    };
  });
};

/**
 * 网易云榜单列表：/api/toplist/detail
 * 返回所有可用排行榜的基本信息（ID、名称、封面）。
 */
export const getNeteaseTopLists = async (): Promise<TopList[]> => {
  const data = await fetchNeteaseJsonWithRetry(
    "/api/toplist/detail",
    (value) => Array.isArray(value?.list),
  );
  const list = data?.list;

  if (!list || !Array.isArray(list)) return [];

  return list.map((item: Record<string, unknown>) => ({
    id: String(item.id),
    name: String(item.name ?? ""),
    updateFrequency: String(item.updateFrequency ?? ""),
    picUrl: normalizeMusicUrl(item.coverImgUrl as string || ""),
    coverImgUrl: normalizeMusicUrl(item.coverImgUrl as string || ""),
  }));
};

/**
 * 网易云榜单详情：/api/v6/playlist/detail
 * 获取指定榜单的前 30 首歌曲列表。
 * @param id 榜单 ID
 */
export const getNeteaseTopListDetail = async (
  id: string | number,
): Promise<Song[]> => {
  const data = await fetchNeteaseJsonWithRetry(
    `/api/v6/playlist/detail?id=${id}&n=30`,
    (value) => Array.isArray(value?.playlist?.tracks),
  );
  const tracks = data?.playlist?.tracks;

  if (!tracks || !Array.isArray(tracks)) return [];

  return tracks.map((s: Record<string, unknown>) => {
    const ar = s.ar;
    const al = s.al;
    return {
      id: String(s.id),
      name: String(s.name ?? ""),
      artist: Array.isArray(ar) ? ar.map((a: Record<string, unknown>) => String(a.name ?? "")).join(", ") : "",
      album: typeof al === "object" && al !== null ? String((al as Record<string, unknown>).name ?? "") : "",
      pic: normalizeMusicUrl(typeof al === "object" && al !== null ? (al as Record<string, unknown>).picUrl as string : ""),
      source: "netease" as const,
    };
  });
};

/**
 * 网易云歌词：优先用 /api/song/lyric/v1 拿 yrc 逐字歌词；
 * 该接口没有逐字轨时再回退旧接口（旧接口仍可能返回 yrc）。
 * 返回带 [tunefree:xxx] 轨标记的合并文档，交给 utils/lyrics 解析。
 */
export const fetchNeteaseLyrics = async (
  id: string | number,
): Promise<string> => {
  try {
    const v1Data = await fetchNeteaseLyricJson(buildNeteaseLyricV1Url(id));
    const v1Tracks = extractNeteaseLyricTracks(v1Data);

    if (v1Tracks.karaoke) {
      return mergeNeteaseLyricPayload(v1Tracks);
    }

    const legacyData = await fetchNeteaseLyricJson(buildNeteaseLyricLegacyUrl(id));
    const legacyTracks = extractNeteaseLyricTracks(legacyData);

    if (legacyTracks.karaoke) {
      return mergeNeteaseLyricPayload(legacyTracks);
    }

    if (hasAnyLyricTrack(v1Tracks)) {
      return mergeNeteaseLyricPayload(v1Tracks);
    }

    return hasAnyLyricTrack(legacyTracks) ? mergeNeteaseLyricPayload(legacyTracks) : "";
  } catch {
    return "";
  }
};

/** @deprecated 保留旧名字兼容既有调用点，请使用 fetchNeteaseLyrics。 */
export const fetchNeteaselyrics = fetchNeteaseLyrics;
