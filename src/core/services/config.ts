import type { LocalServerInfo } from "../ipc/types";

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

export type { LocalServerInfo };

/** 本地服务器令牌请求头（<audio> 等无法设头的场景改用 `token` 查询参数）。 */
export const LOCAL_SERVER_TOKEN_HEADER = "x-tunefree-token";

// 非 Tauri（纯浏览器 dev）环境的降级默认值：固定 3002 端口 + 空 token。
const DEFAULT_LOCAL_SERVER_PORT = 3002;

const buildProxyBase = (port: number): string => `http://127.0.0.1:${port}`;

// token 在前、`url=` 结尾，调用方保持 `SELF_HOSTED_PROXY + encodeURIComponent(target)` 拼接写法。
const buildSelfHostedProxy = (base: string, token: string): string =>
  `${base}/api/cors-proxy?token=${encodeURIComponent(token)}&url=`;

let proxyBase = buildProxyBase(DEFAULT_LOCAL_SERVER_PORT);
let serverToken = "";

export let API_PREFIX = proxyBase;
export let SELF_HOSTED_PROXY = buildSelfHostedProxy(proxyBase, serverToken);

export const DEFAULT_PROXIES: string[] = [
  SELF_HOSTED_PROXY,
];

/** 用后端 `get_local_server_info` 的结果刷新所有本地服务器 URL 与令牌。 */
export const setLocalServerInfo = (info: LocalServerInfo): void => {
  if (!Number.isInteger(info.port) || info.port < 1 || info.port > 65535) {
    throw new Error(`Invalid local server port: ${info.port}`);
  }

  proxyBase = buildProxyBase(info.port);
  serverToken = typeof info.token === "string" ? info.token : "";
  API_PREFIX = proxyBase;
  SELF_HOSTED_PROXY = buildSelfHostedProxy(proxyBase, serverToken);
  DEFAULT_PROXIES.splice(0, DEFAULT_PROXIES.length, SELF_HOSTED_PROXY);
};

export const getLocalServerToken = (): string => serverToken;

export const getLocalServerBase = (): string => proxyBase;

/**
 * 发往本地服务器的 fetch 统一附加的请求头。
 * 浏览器 dev 环境 token 为空时不附加，避免无谓的 CORS 预检。
 */
export const buildLocalServerHeaders = (): Record<string, string> =>
  serverToken ? { [LOCAL_SERVER_TOKEN_HEADER]: serverToken } : {};
