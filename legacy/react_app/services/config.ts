import { Capacitor } from "@capacitor/core";

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

/**
 * Cloudflare Pages 生产环境地址。
 * Capacitor 原生打包时（Android/iOS）无法使用相对路径，
 * 必须使用绝对地址指向已部署的 CF Pages 站点。
 */
export const PRODUCTION_URL = "https://tunefree-mobile.pages.dev";

/**
 * API 前缀：
 * - 原生平台（Capacitor）→ 使用 PRODUCTION_URL 绝对路径
 * - Web 开发模式 → 使用相对路径（由 Vite 代理或 CF Pages 本地模拟处理）
 */
export const API_PREFIX = Capacitor.isNativePlatform() ? PRODUCTION_URL : "";

/**
 * 自建 CORS 代理（Cloudflare Pages Function）。
 * 国内外均可访问，延迟低、无速率限制，始终作为第一优先代理。
 * 该代理是同源请求，fetch 时不需要设置 mode: 'cors'。
 */
export const SELF_HOSTED_PROXY = `${API_PREFIX}/api/cors-proxy?url=`;

/**
 * 默认代理列表：
 * [0] 自建代理（优先）
 * [1] corsproxy.io（兜底备用，公共服务，有速率限制）
 */
export const DEFAULT_PROXIES: string[] = [
  SELF_HOSTED_PROXY,
  "https://corsproxy.io/?",
];
