import { Song, TuneHubMethod, TuneHubResponse } from "../types";
import { FORBIDDEN_HEADERS, SELF_HOSTED_PROXY } from "./config";
import { getStoredApiKey, getStoredApiBase, getProxies } from "./proxy";
import {
  fixUrl,
  findImage,
  extractRawTracks,
  extractList,
  normalizeSongs,
} from "./utils";

// ==============================
// TuneHub 后端 HTTP 客户端
// ==============================

/**
 * 向 TuneHub 后端发起请求。
 * - API Key 仅在解析接口（/v1/parse）中附带，不影响搜索和排行榜
 * - 若响应为 HTML（404/503 默认页面），视为配置错误，返回 null
 */
async function tuneHubFetch<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T | null> {
  const apiKey = getStoredApiKey();
  const apiBase = getStoredApiBase();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  // API Key 仅用于解析接口（/v1/parse），不影响搜索和排行榜
  if (apiKey && endpoint.includes("/parse")) {
    headers["X-API-Key"] = apiKey;
  }

  try {
    const response = await fetch(`${apiBase}${endpoint}`, {
      ...options,
      headers,
    });

    // 收到 HTML 说明 API Base 配置错误（如 404/503 返回了默认页面）
    const contentType = response.headers.get("content-type");
    if (contentType?.includes("text/html")) {
      console.error(
        `TuneHub API Error [${endpoint}]: Received HTML instead of JSON. ` +
          `Check API_BASE (${apiBase}).`,
      );
      return null;
    }

    if (response.status === 401) {
      console.warn("TuneHub: Unauthorized (401). Check API Key.");
      return null;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return await response.json();
  } catch (e) {
    console.error(`TuneHub API Error [${endpoint}]:`, e);
    return null;
  }
}

// ==============================
// 模板引擎 & 代理执行器
// ==============================

/**
 * 从 TuneHub 后端获取平台方法配置，并通过 CORS 代理执行实际请求。
 *
 * 执行流程：
 * 1. 从 /v1/methods/{platform}/{fn} 获取方法配置（url、params、headers、body、transform）
 * 2. 将配置中的 {{expr}} 模板变量用 variables 求值替换
 * 3. 通过代理列表依次发起请求，处理 JSONP 包裹
 * 4. 若配置包含 transform 函数，执行变换；失败时回退到原始数据
 * 5. 对 transform 后未补全的封面字段，从原始响应中补回
 */
export async function executeMethod<T>(
  platform: string,
  fn: string,
  variables: Record<string, string> = {},
): Promise<T | null> {
  const res = await tuneHubFetch<TuneHubResponse<TuneHubMethod>>(
    `/v1/methods/${platform}/${fn}`,
  );
  if (!res || res.code !== 0 || !res.data) return null;

  const config = res.data;
  const proxies = getProxies();

  // ---- 模板引擎 ----

  /**
   * 对 {{expr}} 中的表达式求值，支持：
   * - 简单变量替换：{{keyword}}、{{id}}
   * - 带默认值：{{page || 1}}
   * - 类型转换：{{parseInt(id)}}
   */
  const evalExpr = (expr: string): any => {
    try {
      const keys = Object.keys(variables);
      const vals = keys.map((k) => variables[k]);
      return new Function(...keys, `"use strict"; return (${expr});`)(...vals);
    } catch {
      return "";
    }
  };

  /** 替换字符串中所有 {{expr}} 为求值结果（结果转为 string） */
  const replaceTemplate = (str: string): string =>
    str.replace(/\{\{(.*?)\}\}/g, (_, expr) => String(evalExpr(expr)));

  /**
   * 递归处理 body 对象中的模板变量，保留原始类型：
   * - 完整匹配 {{expr}} → 直接返回求值结果（保留 number / boolean）
   * - 部分匹配 → 字符串替换
   */
  const processBody = (obj: any): any => {
    if (typeof obj === "string") {
      const fullMatch = obj.match(/^\{\{(.*)\}\}$/);
      if (fullMatch) return evalExpr(fullMatch[1]);
      return replaceTemplate(obj);
    }
    if (Array.isArray(obj)) return obj.map(processBody);
    if (typeof obj === "object" && obj !== null) {
      const result: Record<string, any> = {};
      for (const [k, v] of Object.entries(obj)) result[k] = processBody(v);
      return result;
    }
    return obj;
  };

  // ---- 构建请求 URL & 过滤 Headers ----

  let requestUrl = replaceTemplate(config.url);

  if (config.params) {
    const finalParams = new URLSearchParams();
    for (const [k, v] of Object.entries(config.params)) {
      finalParams.append(k, replaceTemplate(v));
    }
    requestUrl +=
      (requestUrl.includes("?") ? "&" : "?") + finalParams.toString();
  }

  const safeHeaders: Record<string, string> = {};
  if (config.headers) {
    for (const [k, v] of Object.entries(config.headers)) {
      if (!FORBIDDEN_HEADERS.includes(k.toLowerCase())) {
        safeHeaders[k] = v;
      }
    }
  }

  requestUrl = fixUrl(requestUrl);

  // ---- 代理轮询 ----

  for (const proxy of proxies) {
    const finalFetchUrl = `${proxy}${encodeURIComponent(requestUrl)}`;

    try {
      console.log(`[TuneHub] Trying proxy: ${proxy} → ${requestUrl}`);

      // 自建代理是同源请求，不设 mode: 'cors'，避免 CF 透传头引发 CORS 预检失败
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const fetchOpts: RequestInit = {
        method: config.method,
        headers: { ...safeHeaders },
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
      };

      if (config.body) {
        fetchOpts.body = JSON.stringify(processBody(config.body));
        if (!(fetchOpts.headers as Record<string, string>)["Content-Type"]) {
          (fetchOpts.headers as Record<string, string>)["Content-Type"] =
            "application/json";
        }
      }

      // 超时：8 秒无响应则中断，防止代理 hang
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      fetchOpts.signal = controller.signal;

      const response = await fetch(finalFetchUrl, fetchOpts);
      clearTimeout(timeoutId);

      // 先读文本，兼容 JSONP 或格式错误的 JSON
      const rawText = await response.text();
      let rawData: any = null;

      // 1. 标准 JSON 解析
      try {
        rawData = JSON.parse(rawText);
      } catch {
        // 2. JSONP 兜底（MusicJsonCallback({...}) 或 callback({...})）
        try {
          const match = rawText.match(/^\s*[\w.]+\s*\((.*)\)\s*;?\s*$/s);
          if (match?.[1]) rawData = JSON.parse(match[1]);
        } catch {
          /* skip */
        }
      }

      if (!rawData) {
        console.warn(`[TuneHub] Proxy ${proxy} returned unparsable data.`);
        continue;
      }

      // ---- 垃圾数据检测 ----
      if (
        Array.isArray(rawData) &&
        rawData.length > 0 &&
        (rawData[0] === "-1" || rawData[0] === -1)
      ) {
        console.warn(`[TuneHub] Proxy ${proxy} returned garbage data [-1].`);
        continue;
      }
      if (rawData.code === -447) {
        console.warn(`[TuneHub] Proxy ${proxy} returned Netease -447.`);
        continue;
      }

      // ---- Transform ----
      if (config.transform) {
        try {
          const transformer = new Function(`return ${config.transform}`)();
          const transformed = transformer(rawData);

          if (!transformed) {
            // transform 返回 null / undefined 时回退到原始数据
            return rawData;
          }

          // TuneHub transform 通常丢弃封面字段，从原始数据中补回
          if (
            Array.isArray(transformed) &&
            transformed.length > 0 &&
            !transformed[0].pic
          ) {
            const rawTracks = extractRawTracks(rawData);
            if (rawTracks.length > 0) {
              // 优先按 ID 匹配，回退到按索引
              const idToRaw = new Map<string, any>();
              for (const rt of rawTracks) {
                const rid = String(
                  rt.id ||
                    rt.rid ||
                    rt.songid ||
                    rt.songmid ||
                    rt.MUSICRID ||
                    "",
                ).replace("MUSIC_", "");
                if (rid) idToRaw.set(rid, rt);
              }

              for (let i = 0; i < transformed.length; i++) {
                const item = transformed[i];
                const raw = idToRaw.get(String(item.id)) || rawTracks[i];
                if (!raw) continue;

                // 网易云: al.picUrl / album.picUrl
                let pic =
                  raw.al?.picUrl || raw.album?.picUrl || findImage(raw) || "";
                // QQ: 通过 albummid 构造封面
                if (!pic) {
                  const mid =
                    raw.albummid || raw.album?.mid || raw.album_mid;
                  if (mid)
                    pic = `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg`;
                }
                if (pic) item.pic = pic;
              }
            }
          }

          return transformed;
        } catch (e) {
          // transform 失败时回退到原始数据（由 normalizeSongs 兜底解析）
          console.warn(
            `[TuneHub] Transform failed, falling back to rawData:`,
            (e as Error)?.message,
          );
          return rawData;
        }
      }

      return rawData;
    } catch (e) {
      console.warn(`[TuneHub] Fetch failed via proxy ${proxy}:`, e);
    }
  }

  console.error("[TuneHub] All proxies failed.");
  return null;
}

// ==============================
// TuneHub Parse API
// ==============================

/**
 * 调用 TuneHub /v1/parse 解析接口，获取歌曲 URL、歌词、封面等完整信息。
 * 返回经 extractList 处理的原始数组（未标准化）。
 */
export const parseSongs = async (
  ids: string,
  platform: string,
  quality: string = "320k",
): Promise<any[] | null> => {
  if (!ids || !platform) return null;
  // 临时 ID（无有效平台 ID）跳过，避免消耗积分
  if (String(ids).startsWith("temp_")) return null;

  const res = await tuneHubFetch<TuneHubResponse<any>>("/v1/parse", {
    method: "POST",
    body: JSON.stringify({ platform, ids, quality }),
  });

  if (!res || !res.data) return null;
  return extractList(res.data);
};

/**
 * 获取单首歌曲的完整信息（已标准化为 Song 对象）。
 * 内部调用 parseSongs + normalizeSongs。
 */
export const getSongInfo = async (
  id: string | number,
  source: string,
): Promise<Song | null> => {
  const data = await parseSongs(String(id), source);
  if (!data || data.length === 0) return null;
  return normalizeSongs(data, source)[0] ?? null;
};
