import { SELF_HOSTED_PROXY } from './config';

const isHost = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

/** 解包历史本地代理；持久化时只保留上游地址，不保存端口或访问令牌。 */
export const stableMusicUrl = (value?: string): string => {
  if (typeof value !== 'string') return '';
  let current = value.trim().replace(/&amp;/g, '&');
  if (current.startsWith('//')) current = `https:${current}`;
  while (current) {
    let parsed: URL;
    try { parsed = new URL(current); } catch { return current; }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if (!loopback || !['http:', 'https:'].includes(parsed.protocol)) return current;
    if (parsed.pathname !== '/api/cors-proxy') return '';
    const target = parsed.searchParams.get('url');
    // 每次解包必须缩短，避免损坏输入造成循环。
    if (!target || target.length >= current.length) return '';
    current = target;
  }
  return '';
};

/** 幂等标准化：旧代理先还原，再使用当前会话的本地服务。 */
export const normalizeMusicUrl = (value?: string): string => {
  const stable = stableMusicUrl(value);
  if (!stable) return '';
  let parsed: URL;
  try { parsed = new URL(stable); } catch { return stable; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return stable;
  if (parsed.protocol === 'http:' &&
    ['music.126.net', 'y.gtimg.cn', 'qpic.cn'].some((host) => isHost(parsed.hostname, host))) {
    parsed.protocol = 'https:';
  }
  if (isHost(parsed.hostname, 'y.gtimg.cn')) {
    parsed.pathname = parsed.pathname.replace('300x300', '500x500');
  }
  const target = parsed.toString();
  return isHost(parsed.hostname, 'hdslb.com') ||
    (parsed.protocol === 'http:' && isHost(parsed.hostname, 'kuwo.cn'))
    ? `${SELF_HOSTED_PROXY}${encodeURIComponent(target)}` : target;
};
