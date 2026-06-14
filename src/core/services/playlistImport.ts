import { Song } from "../types";
import { FORBIDDEN_HEADERS } from "./config";
import { proxyFetch, proxyFetchJson, proxyFetchJsonWithValidator } from "./proxy";
import { qqMusicuFetch } from "./qq";
import { batchFetchKuwoCovers } from "./kuwo";
import { fixUrl, normalizeSongs } from "./utils";

// ==============================
// 在线歌单导入（与 Flutter 版 playlist_import_repository 对齐）
// 直连 netease / qq / kuwo 歌单接口，失败时回落 TuneHub methods 描述符。
// ==============================

export const TUNEHUB_API_BASE = "https://tunehub.sayqz.com/api";

export type PlaylistImportErrorCode =
  | "invalidInput"
  | "sourceMismatch"
  | "unsupportedSource"
  | "emptyPlaylist"
  | "network"
  | "remoteFormat";

export class PlaylistImportError extends Error {
  code: PlaylistImportErrorCode;

  constructor(code: PlaylistImportErrorCode, message?: string) {
    super(message || code);
    this.name = "PlaylistImportError";
    this.code = code;
  }
}

export const PLAYLIST_IMPORT_ERROR_MESSAGES: Record<
  PlaylistImportErrorCode,
  string
> = {
  invalidInput: "无法识别歌单链接或 ID",
  sourceMismatch: "链接与所选音源不一致",
  unsupportedSource: "暂不支持该音源歌单导入",
  emptyPlaylist: "歌单为空或暂时无法访问",
  network: "网络异常，导入失败，请稍后重试",
  remoteFormat: "解析歌单数据失败",
};

export const getPlaylistImportErrorMessage = (error: unknown): string =>
  error instanceof PlaylistImportError
    ? PLAYLIST_IMPORT_ERROR_MESSAGES[error.code]
    : PLAYLIST_IMPORT_ERROR_MESSAGES.network;

export const PLAYLIST_IMPORT_SOURCES = [
  { value: "netease", label: "网易云", placeholder: "歌单链接或 ID，如 music.163.com/playlist?id=..." },
  { value: "qq", label: "QQ音乐", placeholder: "歌单链接或 ID，如 y.qq.com/.../playlist/..." },
  { value: "kuwo", label: "酷我音乐", placeholder: "歌单链接或 ID，如 kuwo.cn/playlist_detail/..." },
] as const;

export interface ImportedPlaylistPayload {
  name: string;
  songs: Song[];
}

// ==============================
// 输入解析：链接源检测 + 歌单 ID 提取
// ==============================

const detectSource = (input: string): string | null => {
  const lower = input.toLowerCase();
  if (lower.includes("music.163.com") || lower.includes("y.music.163.com")) {
    return "netease";
  }
  if (lower.includes("y.qq.com") || lower.includes("i.y.qq.com")) return "qq";
  if (lower.includes("kuwo.cn")) return "kuwo";
  return null;
};

const firstRegexGroup = (input: string, pattern: RegExp): string | null =>
  pattern.exec(input)?.[1] || null;

const rawInputId = (input: string): string | null =>
  /^[A-Za-z0-9_-]+$/.test(input) ? input : null;

const extractNeteasePlaylistId = (input: string): string | null =>
  firstRegexGroup(input, /(?:[?&#]|\/)id=(\d+)/) ||
  firstRegexGroup(input, /playlist\?id=(\d+)/) ||
  firstRegexGroup(input, /\/playlist\/(\d+)/) ||
  rawInputId(input);

const extractQqPlaylistId = (input: string): string | null =>
  firstRegexGroup(input, /(?:[?&#])(?:dissid|id|dirid)=([A-Za-z0-9_-]+)/) ||
  firstRegexGroup(input, /\/playlist\/([A-Za-z0-9_-]+)/) ||
  rawInputId(input);

const extractKuwoPlaylistId = (input: string): string | null =>
  firstRegexGroup(input, /(?:[?&#])pid=([A-Za-z0-9_-]+)/) ||
  firstRegexGroup(input, /\/playlist_detail\/(\d+)/) ||
  firstRegexGroup(input, /\/playlist\/(\d+)/) ||
  rawInputId(input);

export const parsePlaylistImportInput = (
  source: string,
  input: string,
): { source: string; id: string } => {
  const normalizedSource = source.trim();
  const trimmedInput = input.trim();
  if (!trimmedInput) throw new PlaylistImportError("invalidInput");

  const detected = detectSource(trimmedInput);
  if (detected && detected !== normalizedSource) {
    throw new PlaylistImportError("sourceMismatch");
  }

  let id: string | null = null;
  if (normalizedSource === "netease") id = extractNeteasePlaylistId(trimmedInput);
  else if (normalizedSource === "qq") id = extractQqPlaylistId(trimmedInput);
  else if (normalizedSource === "kuwo") id = extractKuwoPlaylistId(trimmedInput);
  else throw new PlaylistImportError("unsupportedSource");

  if (!id) throw new PlaylistImportError("invalidInput");
  return { source: normalizedSource, id };
};

// ==============================
// 直连：网易云歌单（v6 detail，tracks 截断时按 trackIds 分批补齐）
// ==============================

const NETEASE_SONG_DETAIL_BATCH = 100;

const neteaseSongFromTrack = (s: any): Song => ({
  id: String(s.id),
  name: s.name || "",
  artist:
    (s.ar || s.artists)?.map((a: any) => a.name).join(", ") || "",
  album: s.al?.name || s.album?.name || "",
  pic: fixUrl(s.al?.picUrl || s.album?.picUrl || ""),
  source: "netease" as const,
});

const fetchNeteaseSongsByIds = async (ids: string[]): Promise<Song[]> => {
  const result: Song[] = [];
  for (let i = 0; i < ids.length; i += NETEASE_SONG_DETAIL_BATCH) {
    const batch = ids.slice(i, i + NETEASE_SONG_DETAIL_BATCH);
    try {
      const data = await proxyFetchJson(
        `https://music.163.com/api/song/detail?ids=[${batch.join(",")}]`,
      );
      const songs = data?.songs;
      if (Array.isArray(songs)) {
        result.push(...songs.map(neteaseSongFromTrack));
      }
    } catch {
      /* 跳过失败批次，部分结果依然可用 */
    }
  }
  return result;
};

const importNeteasePlaylist = async (
  id: string,
): Promise<ImportedPlaylistPayload | null> => {
  const data = await proxyFetchJson(
    `https://music.163.com/api/v6/playlist/detail?id=${id}&n=1000`,
  );
  const playlist = data?.playlist;
  if (!playlist) return null;

  const tracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const songs: Song[] = tracks.map(neteaseSongFromTrack);

  // tracks 被接口截断时，用 trackIds 走 song/detail 分批补齐
  const allTrackIds: string[] = Array.isArray(playlist.trackIds)
    ? playlist.trackIds.map((t: any) => String(t?.id)).filter(Boolean)
    : [];
  if (allTrackIds.length > songs.length) {
    const existing = new Set(songs.map((s) => String(s.id)));
    const missing = allTrackIds.filter((tid) => !existing.has(tid));
    songs.push(...(await fetchNeteaseSongsByIds(missing)));
  }

  if (songs.length === 0) return null;
  return { name: String(playlist.name || id), songs };
};

// ==============================
// 直连：QQ 音乐歌单（srf_diss_info CgiGetDiss，单次最多 500 首）
// ==============================

const importQQPlaylist = async (
  id: string,
): Promise<ImportedPlaylistPayload | null> => {
  const numericId = /^\d+$/.test(id) ? Number(id) : id;
  const data = await qqMusicuFetch({
    module: "srf_diss_info.DissInfoServer",
    method: "CgiGetDiss",
    param: {
      disstid: numericId,
      dirid: 0,
      song_begin: 0,
      song_num: 500,
    },
  });
  if (!data) return null;

  const list =
    data.songlist ||
    data.songList ||
    data.data?.songlist ||
    data.data?.songList ||
    [];
  const songs = normalizeSongs(list, "qq");
  if (songs.length === 0) return null;

  const name =
    data.dirinfo?.title || data.dirInfo?.title || data.title || data.name || id;
  return { name: String(name), songs };
};

// ==============================
// 直连：酷我歌单（nplserver pl.svc，单引号 dict 容错）
// ==============================

const fetchTolerantJson = async (rawUrl: string): Promise<any> => {
  const resp = await proxyFetch(rawUrl);
  if (!resp) return null;
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    /* 继续尝试 */
  }
  try {
    return JSON.parse(text.replace(/'/g, '"'));
  } catch {
    /* 继续尝试 */
  }
  const m = text.match(/^\s*[\w.]+\s*\((.*)\)\s*;?\s*$/s);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {
      /* 放弃 */
    }
  }
  return null;
};

const importKuwoPlaylist = async (
  id: string,
): Promise<ImportedPlaylistPayload | null> => {
  const data = await fetchTolerantJson(
    `http://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${id}&pn=0&rn=500&encode=utf-8&keyset=pl2012&identity=kuwo`,
  );
  if (!data) return null;

  const list =
    data.musiclist ||
    data.musicList ||
    data.list ||
    data.data?.musiclist ||
    data.data?.musicList ||
    data.data?.list ||
    [];
  const songs = await batchFetchKuwoCovers(normalizeSongs(list, "kuwo"));
  if (songs.length === 0) return null;

  const name =
    data.title || data.name || data.playlist?.name || data.data?.name || id;
  return { name: String(name), songs };
};

// ==============================
// TuneHub methods 兜底：拉取方法描述符 → 模板求值 → 执行实际请求
// 模板支持 {{id}}、{{parseInt(id)}}、{{a || b || 'c'}}
// ==============================

const evaluateTemplateExpression = (
  expression: string,
  variables: Record<string, string>,
): any => {
  const trimmed = expression.trim();

  if (trimmed.startsWith("parseInt(") && trimmed.endsWith(")")) {
    const key = trimmed.slice("parseInt(".length, -1).trim();
    const parsed = parseInt(variables[key] || "", 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  if (trimmed.includes("||")) {
    for (const segment of trimmed.split("||").map((s) => s.trim())) {
      const value = variables[segment];
      if (value) return value;
      const numeric = parseInt(segment, 10);
      if (!Number.isNaN(numeric) && /^\d+$/.test(segment)) return numeric;
      if (
        (segment.startsWith("'") && segment.endsWith("'")) ||
        (segment.startsWith('"') && segment.endsWith('"'))
      ) {
        return segment.slice(1, -1);
      }
    }
    return "";
  }

  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }

  return variables[trimmed] ?? "";
};

const replaceTemplates = (
  template: string,
  variables: Record<string, string>,
): string =>
  template.replace(/\{\{(.*?)\}\}/g, (_, expr) => {
    const value = evaluateTemplateExpression(expr, variables);
    return value === null || value === undefined ? "" : String(value);
  });

const resolveTemplateValue = (
  value: any,
  variables: Record<string, string>,
): any => {
  if (typeof value === "string") {
    if (value.startsWith("{{") && value.endsWith("}}")) {
      return evaluateTemplateExpression(value.slice(2, -2), variables);
    }
    return replaceTemplates(value, variables);
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveTemplateValue(item, variables));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        resolveTemplateValue(v, variables),
      ]),
    );
  }
  return value;
};

const extractImportSongList = (payload: any): any[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const candidates = [
    payload.tracks,
    payload.songs,
    payload.list,
    payload.songlist,
    payload.playlist?.tracks,
    payload.result?.tracks,
    payload.result?.songs,
    payload.data?.songlist,
    payload.data?.songList,
    payload.data?.song?.list,
    payload.toplist?.data?.songInfoList,
    payload.musiclist,
    payload.musicList,
    payload.abslist,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate;
  }
  if (Array.isArray(payload.data)) return payload.data;
  return [];
};

const extractImportPlaylistName = (payload: any): string | null => {
  if (!payload || typeof payload !== "object") return null;
  return (
    payload.name ||
    payload.info?.name ||
    payload.playlist?.name ||
    payload.data?.name ||
    payload.result?.name ||
    null
  );
};

const importViaTuneHub = async (
  source: string,
  id: string,
): Promise<ImportedPlaylistPayload | null> => {
  const descriptorResp = await proxyFetchJsonWithValidator(
    `${TUNEHUB_API_BASE}/v1/methods/${source}/playlist`,
    {},
    (data) => !!data && typeof data === "object",
  );
  const descriptor = descriptorResp?.data;
  if (!descriptor || typeof descriptor !== "object") return null;

  const variables: Record<string, string> = { id };
  const method = String(descriptor.method || "GET").toUpperCase();

  let url = replaceTemplates(String(descriptor.url || ""), variables);
  if (!url) return null;
  const params = resolveTemplateValue(descriptor.params, variables);
  if (params && typeof params === "object") {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== null && v !== undefined) query.set(k, String(v));
    }
    const queryText = query.toString();
    if (queryText) url += (url.includes("?") ? "&" : "?") + queryText;
  }

  const headers: Record<string, string> = {};
  if (descriptor.headers && typeof descriptor.headers === "object") {
    for (const [k, v] of Object.entries(descriptor.headers)) {
      if (FORBIDDEN_HEADERS.includes(k.toLowerCase())) continue;
      headers[k] = replaceTemplates(String(v), variables);
    }
  }

  const body = resolveTemplateValue(descriptor.body, variables);
  const options: RequestInit = { method, headers };
  if (method !== "GET" && body !== null && body !== undefined) {
    const hasContentType = Object.keys(headers).some(
      (k) => k.toLowerCase() === "content-type",
    );
    if (typeof body === "string") {
      options.body = body;
    } else {
      options.body = JSON.stringify(body);
      if (!hasContentType) headers["Content-Type"] = "application/json";
    }
  }

  const resp = await proxyFetch(url, options as any);
  if (!resp) return null;
  const text = await resp.text();
  let payload: any = null;
  try {
    payload = JSON.parse(text);
  } catch {
    const m = text.match(/^\s*[\w.]+\s*\((.*)\)\s*;?\s*$/s);
    if (m) {
      try {
        payload = JSON.parse(m[1]);
      } catch {
        return null;
      }
    }
  }
  if (!payload) return null;

  const songs = normalizeSongs(extractImportSongList(payload), source);
  if (songs.length === 0) return null;
  return { name: String(extractImportPlaylistName(payload) || id), songs };
};

// ==============================
// 组合入口：直连优先 → TuneHub 兜底
// ==============================

const importDirect = (
  source: string,
  id: string,
): Promise<ImportedPlaylistPayload | null> => {
  if (source === "netease") return importNeteasePlaylist(id);
  if (source === "qq") return importQQPlaylist(id);
  if (source === "kuwo") return importKuwoPlaylist(id);
  throw new PlaylistImportError("unsupportedSource");
};

export const importPlaylist = async (
  source: string,
  input: string,
): Promise<ImportedPlaylistPayload> => {
  const parsed = parsePlaylistImportInput(source, input);

  let primaryError: unknown = null;
  try {
    const payload = await importDirect(parsed.source, parsed.id);
    if (payload && payload.songs.length > 0) return payload;
  } catch (error) {
    if (
      error instanceof PlaylistImportError &&
      error.code === "unsupportedSource"
    ) {
      throw error;
    }
    primaryError = error;
  }

  try {
    const payload = await importViaTuneHub(parsed.source, parsed.id);
    if (payload && payload.songs.length > 0) return payload;
  } catch (error) {
    console.warn("[PlaylistImport] TuneHub fallback failed:", error);
    if (primaryError) {
      throw new PlaylistImportError("network");
    }
  }

  throw new PlaylistImportError("emptyPlaylist");
};
