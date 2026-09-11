import { SELF_HOSTED_PROXY } from "./config";

const isHost = (hostname: string, domain: string): boolean =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** 必须走自建代理的图床：不支持 HTTPS 或带防盗链，浏览器直连会被拦截。 */
const PROXIED_IMAGE_HOSTS = ["hdslb.com", "biliimg.com"];

/** 已知支持 HTTPS、可以就地升级的音频 / 图床 CDN。 */
const HTTPS_UPGRADE_HOSTS = [
  "music.126.net",
  "y.gtimg.cn",
  "qpic.cn",
  // QQ 音乐流媒体：ws / sjy6 / isure / dl.stream.qqmusic.qq.com、aqqmusic.tc.qq.com。
  // vkey 返回的 sip 一律是 http，而同一 purl 换成 https 实测同样 206 audio/mpeg。
  "qqmusic.qq.com",
  "tc.qq.com",
  // JOOX 直接返回 https，列在这里是为了兜住历史缓存里的 http 地址。
  "stream.music.joox.com",
];

/**
 * 解包历史本地代理地址，只保留上游地址。
 *
 * 开发环境（127.0.0.1:3000）播放过的歌曲会把带端口的代理地址写进 localStorage，
 * 之后换成线上域名打开时这些地址全部失效。所以读取和持久化前都要先还原。
 * PWA 的自建代理是相对路径（/api/cors-proxy?url=…），也要一并解包，
 * 否则存进曲库 / 导出的 JSON 里永远是相对地址，换环境就失效。
 */
export const stableMusicUrl = (value?: string): string => {
  if (typeof value !== "string") return "";
  let current = value.trim().replace(/&amp;/g, "&");
  if (current.startsWith("//")) current = `https:${current}`;

  const RELATIVE_PROXY_PREFIX = "/api/cors-proxy?url=";
  if (current.startsWith(RELATIVE_PROXY_PREFIX)) {
    try {
      const target = decodeURIComponent(
        current.slice(RELATIVE_PROXY_PREFIX.length),
      );
      // 解包必须让字符串变短，避免损坏输入造成死循环
      if (target && target.length < current.length) return target;
    } catch {
      /* fall through */
    }
    return "";
  }

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
  // 剩余仍是 http 的地址一律交给自建代理。PWA 跑在 https 源上，iOS 会直接拦截
  // http 媒体请求（错误码 4 / NotSupportedError），由代理转发才能正常播。
  const needsProxy =
    PROXIED_IMAGE_HOSTS.some((host) => isHost(parsed.hostname, host)) ||
    parsed.protocol === "http:";
  return needsProxy
    ? `${SELF_HOSTED_PROXY}${encodeURIComponent(target)}`
    : target;
};

/** @deprecated 新代码请直接使用 normalizeMusicUrl。 */
export const fixUrl = normalizeMusicUrl;
