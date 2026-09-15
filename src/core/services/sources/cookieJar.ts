/**
 * 每个音源脚本独立的 Cookie 会话保持。
 *
 * 洛雪脚本用 `lx.request` 登录/取 token 是常见做法（例如小熊猫音源的酷我通路），
 * 而浏览器里的 JS 读不到 `set-cookie`。源代理把 `set-cookie` 放在信封的 `cookies`
 * 字段里回传，这里按 RFC 6265 的最小可用子集做存储与匹配：
 * 域名（含 host-only 与子域）、路径前缀、Secure、Max-Age / Expires。
 *
 * 只保存在内存里（随沙箱释放），不落盘。
 */

interface StoredCookie {
  name: string;
  value: string;
  /** 小写域名（不含前导点）。 */
  domain: string;
  /** 未声明 Domain 时只能精确匹配该主机。 */
  hostOnly: boolean;
  path: string;
  secure: boolean;
  /** 毫秒时间戳；`Number.POSITIVE_INFINITY` 表示会话级 cookie。 */
  expiresAt: number;
}

/** 单个脚本最多保留的 cookie 数，防止脚本无限写入。 */
const MAX_COOKIES = 50;
/** 单条 cookie 名/值的长度上限（避免畸形响应撑爆内存）。 */
const MAX_NAME_LENGTH = 256;
const MAX_VALUE_LENGTH = 4096;

const parseAttributes = (parts: string[]): Map<string, string> => {
  const attributes = new Map<string, string>();
  for (const part of parts) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      attributes.set(part.trim().toLowerCase(), '');
      continue;
    }
    const key = part.slice(0, separator).trim().toLowerCase();
    const value = part.slice(separator + 1).trim();
    if (key) attributes.set(key, value);
  }
  return attributes;
};

const parseMaxAge = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return seconds <= 0 ? 0 : Date.now() + seconds * 1000;
};

const parseExpires = (value: string | undefined): number | null => {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export class CookieJar {
  private cookies: StoredCookie[] = [];

  /** 记录一次响应里的 `set-cookie`（`requestUrl` 决定默认域名与路径）。 */
  store(requestUrl: string, setCookieValues: readonly string[]): void {
    if (setCookieValues.length === 0) return;
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return;
    }
    const host = url.hostname.toLowerCase();

    for (const raw of setCookieValues) {
      const segments = String(raw).split(';');
      const pair = segments[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!name || name.length > MAX_NAME_LENGTH || value.length > MAX_VALUE_LENGTH) continue;

      const attributes = parseAttributes(segments.slice(1));
      const domainAttribute = attributes.get('domain');
      const domain = domainAttribute ? domainAttribute.replace(/^\./, '').toLowerCase() : host;
      // 只接受能覆盖请求主机的 Domain，避免第三方响应给你塞别人的 cookie。
      if (domainAttribute && domain !== host && !host.endsWith(`.${domain}`)) continue;
      const declaredPath = attributes.get('path');
      const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/';
      const path = declaredPath?.startsWith('/') ? declaredPath : defaultPath;
      const expiresAt =
        parseMaxAge(attributes.get('max-age')) ?? parseExpires(attributes.get('expires')) ?? Number.POSITIVE_INFINITY;

      const cookie: StoredCookie = {
        name,
        value,
        domain,
        hostOnly: !domainAttribute,
        path,
        secure: attributes.has('secure'),
        expiresAt,
      };

      const duplicateIndex = this.cookies.findIndex(
        (existing) => existing.name === name && existing.domain === domain && existing.path === path,
      );
      if (duplicateIndex >= 0) this.cookies[duplicateIndex] = cookie;
      else this.cookies.push(cookie);
    }

    this.prune();
  }

  /** 生成请求要带的 `Cookie` 头；没有可用 cookie 时返回空串。 */
  headerFor(requestUrl: string): string {
    let url: URL;
    try {
      url = new URL(requestUrl);
    } catch {
      return '';
    }
    const host = url.hostname.toLowerCase();
    const isSecure = url.protocol === 'https:';
    const now = Date.now();

    return this.cookies
      .filter((cookie) => {
        if (cookie.expiresAt <= now) return false;
        if (cookie.secure && !isSecure) return false;
        const domainMatches = cookie.hostOnly
          ? host === cookie.domain
          : host === cookie.domain || host.endsWith(`.${cookie.domain}`);
        if (!domainMatches) return false;
        return url.pathname === cookie.path || (url.pathname.startsWith(cookie.path)
          && (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'));
      })
      .sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`)
      .join('; ');
  }

  /** 当前有效的 cookie 数量（界面与日志用）。 */
  size(): number {
    const now = Date.now();
    return this.cookies.filter((cookie) => cookie.expiresAt > now).length;
  }

  clear(): void {
    this.cookies = [];
  }

  private prune(): void {
    const now = Date.now();
    this.cookies = this.cookies.filter((cookie) => cookie.expiresAt > now);
    if (this.cookies.length > MAX_COOKIES) {
      this.cookies = this.cookies.slice(this.cookies.length - MAX_COOKIES);
    }
  }
}
