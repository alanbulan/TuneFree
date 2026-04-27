/** TuneHub 后端默认地址（用户可在设置中覆盖） */
export const DEFAULT_API_BASE = "https://tunehub.sayqz.com/api";

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

/** Cloudflare Pages 生产环境地址。 */
export const PRODUCTION_URL = "https://tunefree-mobile.pages.dev";

/** API 前缀：Web/PWA 使用相对路径。 */
export const API_PREFIX = "";

const shouldUseAbsoluteProxy =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");
const proxyBase = shouldUseAbsoluteProxy ? PRODUCTION_URL : API_PREFIX;

/**
 * 自建 CORS 代理（Cloudflare Pages Function）。
 * 国内外均可访问，延迟低、无速率限制，始终作为第一优先代理。
 * 本地 Vite 开发时改为直连线上 Pages Function，避免 /api 在 dev server 下 404。
 */
export const SELF_HOSTED_PROXY = `${proxyBase}/api/cors-proxy?url=`;

/**
 * 默认代理列表：
 * [0] 自建代理（优先）
 * [1] corsproxy.io（兜底备用，公共服务，有速率限制）
 */
export const DEFAULT_PROXIES: string[] = [
  SELF_HOSTED_PROXY,
  "https://corsproxy.io/?",
];
