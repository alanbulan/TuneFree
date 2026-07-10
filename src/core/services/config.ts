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



const DEFAULT_LOCAL_SERVER_PORT = 3002;

const buildProxyBase = (port: number): string => `http://127.0.0.1:${port}`;

let proxyBase = buildProxyBase(DEFAULT_LOCAL_SERVER_PORT);

export let API_PREFIX = proxyBase;
export let SELF_HOSTED_PROXY = `${proxyBase}/api/cors-proxy?url=`;

export const DEFAULT_PROXIES: string[] = [
  SELF_HOSTED_PROXY,
];

export const setLocalServerPort = (port: number): void => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid local server port: ${port}`);
  }

  proxyBase = buildProxyBase(port);
  API_PREFIX = proxyBase;
  SELF_HOSTED_PROXY = `${proxyBase}/api/cors-proxy?url=`;
  DEFAULT_PROXIES.splice(0, DEFAULT_PROXIES.length, SELF_HOSTED_PROXY);
};

export const getLocalServerBase = (): string => proxyBase;
