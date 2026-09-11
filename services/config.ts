export const GD_STUDIO_API_BASE = "https://music-api.gdstudio.xyz/api.php";

export const FORBIDDEN_HEADERS = [
  "user-agent",
  "referer",
  "host",
  "origin",
  "cookie",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "connection",
  "content-length",
];

export const IS_LOCAL_DEV =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

export const API_PREFIX = "";
export const SELF_HOSTED_PROXY = `${API_PREFIX}/api/cors-proxy?url=`;

/**
 * 代理候选列表。corsproxy.io 曾作为兜底，现在匿名 URL 已被上游下线
 * （返回 `keyless_legacy_url` 错误），继续留在列表里只会让每次失败解析
 * 多等一轮超时，所以只保留自建代理。用户自填的代理仍在 getProxies 里合并。
 */
export const DEFAULT_PROXIES: string[] = [SELF_HOSTED_PROXY];
