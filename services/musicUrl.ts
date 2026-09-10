import { SELF_HOSTED_PROXY } from "./config";

const isHost = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** 必须走自建代理的图床：不支持 HTTPS 或带防盗链，浏览器直连会被拦截。 */
const PROXIED_IMAGE_HOSTS = ["hdslb.com", "biliimg.com"];

/** 已知支持 HTTPS、可以就地升级的图床。 */
const HTTPS_UPGRADE_HOSTS = ["music.126.net", "y.gtimg.cn", "qpic.cn"];

/**
 * 解包历史本地代理地址，只保留上游地址。
 *
 * 开发环境（127.0.0.1:3000）播放过的歌曲会把带端口的代理地址写进 localStorage，
 * 之后换成线上域名打开时这些地址全部失效。所以读取和持久化前都要先还原。
 */
export const stableMusicUrl = (value?: string): string => {
  if (typeof value !== "string") return "";
  let current = value.trim().replace(/&amp;/g, "&");
  if (current.startsWith("//")) current = `https:${current}`;
  while (current) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return current;
    }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
      parsed.hostname,
    );
    if (!loopback || !["http:", "https:"].includes(parsed.protocol)) {
      return current;
    }
    if (parsed.pathname !== "/api/cors-proxy") return "";
    const target = parsed.searchParams.get("url");
    // 每次解包都必须让字符串变短，避免损坏输入造成死循环
    if (!target || target.length >= current.length) return "";
    current = target;
  }
  return "";
};

/** 幂等标准化：先还原历史代理地址，再按当前会话的代理策略重新包装。 */
export const normalizeMusicUrl = (value?: string): string => {
  const stable = stableMusicUrl(value);
  if (!stable) return "";

  let parsed: URL;
  try {
    parsed = new URL(stable);
  } catch {
    return stable;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return stable;

  if (
    parsed.protocol === "http:" &&
    HTTPS_UPGRADE_HOSTS.some((host) => isHost(parsed.hostname, host))
  ) {
    parsed.protocol = "https:";
  }

  // QQ 封面尺寸升级：300x300 → 500x500（只对已知图床生效，
  // 避免把无关 URL 里恰好出现的 300x300 也改掉）
  if (isHost(parsed.hostname, "y.gtimg.cn")) {
    parsed.pathname = parsed.pathname.replace("300x300", "500x500");
  }

  const target = parsed.toString();
  return PROXIED_IMAGE_HOSTS.some((host) => isHost(parsed.hostname, host)) ||
    (parsed.protocol === "http:" && isHost(parsed.hostname, "kuwo.cn"))
    ? `${SELF_HOSTED_PROXY}${encodeURIComponent(target)}`
    : target;
};

/** @deprecated 新代码请直接使用 normalizeMusicUrl。 */
export const fixUrl = normalizeMusicUrl;
