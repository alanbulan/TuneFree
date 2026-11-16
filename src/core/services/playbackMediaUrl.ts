import { SELF_HOSTED_PROXY } from './config';
import { stableMusicUrl } from './musicUrl';

/** 仅声明稳定的公共媒体 CDN；自定义音源地址保持原样，后端仍校验相同白名单。 */
export const PLAYBACK_PROXY_HOSTS: readonly string[] = [
  'music.126.net', 'qqmusic.qq.com', 'kuwo.cn', 'sycdn.kuwo.cn', 'hdslb.com',
];
const covered = (host: string): boolean => PLAYBACK_PROXY_HOSTS.some((domain) =>
  host === domain || host.endsWith(`.${domain}`));

/** 上游签名 query 不经过 URLSearchParams 重建；只对整个目标编码一层。 */
export const normalizeProxyPlayableUrl = (value: string): string => {
  const stable = stableMusicUrl(value);
  let url: URL;
  try { url = new URL(stable); } catch { return value; }
  if (!['http:', 'https:'].includes(url.protocol) || !covered(url.hostname)) return value;
  return `${SELF_HOSTED_PROXY}${encodeURIComponent(stable)}`;
};

export const canAnalyseMediaUrl = (value: string): boolean => {
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin || url.hostname === 'asset.localhost'
      || ['blob:', 'data:', 'asset:'].includes(url.protocol)
      || (url.hostname === '127.0.0.1' && url.pathname === '/api/cors-proxy');
  } catch { return false; }
};
