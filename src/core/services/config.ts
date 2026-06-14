/** GD Studio 音源 API 地址（搜索 / 播放链接 / 歌词 / 封面） */
export const GD_STUDIO_API_BASE = "https://music-api.gdstudio.xyz/api.php";

/**
 * 代理透传时需要过滤掉的请求头列表。
 * 浏览器禁止 JS 设置这些头，CORS 代理转发时也必须跳过，
 * 否则会触发目标服务器的安全拦截或导致预检失败。
 */
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

export const PRODUCTION_URL = "https://tunefree-mobile.pages.dev";

const isTauri =
  typeof window !== "undefined" &&
  ((window as any).__TAURI_INTERNALS__ !== undefined || (window as any).__TAURI__ !== undefined);

const isLocalDesktop =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

const proxyBase = isTauri
  ? "http://127.0.0.1:3002"
  : (isLocalDesktop ? PRODUCTION_URL : "");

export const API_PREFIX = proxyBase;
export const SELF_HOSTED_PROXY = `${proxyBase}/api/cors-proxy?url=`;

export const DEFAULT_PROXIES: string[] = [SELF_HOSTED_PROXY];
