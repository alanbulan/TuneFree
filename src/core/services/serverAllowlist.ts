import { isTauri } from '../ipc/env';
import type { AllowedHostsResponse } from '../ipc/types';
import { buildLocalServerHeaders, getLocalServerBase } from './config';

// ==============================
// 音源 host 白名单启动自检（仅开发/诊断用途）
// 后端 `api/proxy.rs` 的 ALLOWED_HOSTS 与前端实际请求的 host 双端手工同步，
// 这里在启动后拉取 GET /api/allowed-hosts 做一次 diff，缺失只告警、不影响启动。
// ==============================

/**
 * 前端各 service 会经本地 cors-proxy 请求的 host 清单。
 * 新增音源接口时必须同步维护此列表（以及后端 ALLOWED_HOSTS）。
 */
export const PROXY_REQUIRED_HOSTS: readonly string[] = [
  'music.163.com',           // netease.ts / playlistImport.ts / gdStudio.ts 网易封面
  'u.y.qq.com',              // qq.ts musicu.fcg
  'search.kuwo.cn',          // kuwo.ts 搜索
  'artistpicserver.kuwo.cn', // kuwo.ts 封面补全
  'kbangserver.kuwo.cn',     // kuwo.ts 榜单
  'newlyric.kuwo.cn',        // kuwo.ts 逐字歌词
  'kuwo.cn',                 // kuwo.ts openapi 歌词
  'm.kuwo.cn',               // kuwo.ts 歌词降级
  'nplserver.kuwo.cn',       // playlistImport.ts 酷我歌单
  'music-api.gdstudio.xyz',  // gdStudioClient.ts
  'tunehub.sayqz.com',       // playlistImport.ts TuneHub 兜底
  'hdslb.com',               // utils.ts normalizeMusicUrl 代理 B 站封面图
];

// 与后端 is_allowed_host 相同的子域匹配规则（sub.kuwo.cn 命中 kuwo.cn）。
const isHostCovered = (host: string, allowed: readonly string[]): boolean =>
  allowed.some(
    (entry) =>
      host === entry ||
      (host.length > entry.length + 1 && host.endsWith(`.${entry}`)),
  );

/**
 * 启动自检：拉取后端代理白名单，与前端实际请求的 host 列表比对。
 * 任何失败都只 console.warn，不得影响启动流程。
 */
export const verifyProxyAllowlist = async (): Promise<void> => {
  if (!isTauri()) return;

  try {
    const resp = await fetch(`${getLocalServerBase()}/api/allowed-hosts`, {
      headers: buildLocalServerHeaders(),
    });
    if (!resp.ok) {
      console.warn(`[Allowlist] 获取后端代理白名单失败：HTTP ${resp.status}`);
      return;
    }

    const data = (await resp.json()) as AllowedHostsResponse | null;
    const hosts = data?.hosts;
    if (!Array.isArray(hosts) || !hosts.every((h) => typeof h === 'string')) {
      console.warn('[Allowlist] /api/allowed-hosts 响应格式不符合预期');
      return;
    }

    for (const host of PROXY_REQUIRED_HOSTS) {
      if (!isHostCovered(host, hosts)) {
        console.warn(
          `[Allowlist] 前端请求 ${host}，但后端代理白名单没有它，相关代理请求将被 403 拒绝`,
        );
      }
    }
  } catch (error) {
    console.warn('[Allowlist] 代理白名单自检失败（仅诊断用途，不影响启动）:', error);
  }
};
