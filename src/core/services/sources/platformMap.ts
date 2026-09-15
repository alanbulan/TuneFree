import type { SourceResolveRequest } from './types';
import type { LxSourceDeclaration } from './protocol';

/**
 * 洛雪平台键与本应用平台键的互转，以及 `lx.request` 的 musicInfo 构造。
 *
 * 洛雪音源只认 wy / tx / kw / kg / mg（外加仅供本地文件使用的 local），
 * 对应网易、QQ、酷我、酷狗与咪咕的平台标识。
 */

export const LX_TO_APP_PLATFORM: Readonly<Record<string, string>> = {
  wy: 'netease',
  tx: 'qq',
  kw: 'kuwo',
  kg: 'kugou',
  mg: 'migu',
  // GD 专属平台：不在洛雪词表里，是给内置脚本用的扩展键
  joox: 'joox',
  bilibili: 'bilibili',
};

export const APP_TO_LX_PLATFORM: Readonly<Record<string, string>> = {
  netease: 'wy',
  qq: 'tx',
  kuwo: 'kw',
  kugou: 'kg',
  migu: 'mg',
  joox: 'joox',
  bilibili: 'bilibili',
};

/** 请求的音质不可用时，优先选择最高的已知音质。 */
export const QUALITY_FALLBACK_ORDER: readonly string[] = ['flac24bit', 'flac', '320k', '128k'];

/** 洛雪平台键 → 应用平台键；`local` 与未知键返回 null。 */
export const toAppPlatform = (lxPlatform: string): string | null =>
  LX_TO_APP_PLATFORM[lxPlatform] ?? null;

/** 应用平台键 → 洛雪平台键。 */
export const toLxPlatform = (platform: string): string | null =>
  APP_TO_LX_PLATFORM[platform] ?? null;

/**
 * 在脚本声明的音质里挑选一个可用的。
 *
 * - 未声明 `qualitys`：交给脚本自己决定（返回请求音质）。
 * - 声明为空数组：该平台不可用（返回 null，调用方应跳过这个 provider）。
 * - 请求音质不在声明内：按 [`QUALITY_FALLBACK_ORDER`] 选择，最后退回声明列表首项。
 */
export const pickQuality = (requested: string, declared?: string[]): string | null => {
  if (!declared) return requested;
  if (declared.length === 0) return null;
  if (declared.includes(requested)) return requested;
  for (const candidate of QUALITY_FALLBACK_ORDER) {
    if (declared.includes(candidate)) return candidate;
  }
  return declared[0];
};

/**
 * 构造洛雪脚本的 `info.musicInfo`。
 *
 * 取值覆盖真实音源集里出现过的字段（songmid 为主，另有 hash / id / name / singer /
 * albumName / interval 等）。内置三个平台的歌曲 id 与洛雪的 `songmid` 语义一致：
 * 网易=歌曲 id、QQ=songmid、酷我=rid。
 */
export const buildMusicInfo = (request: SourceResolveRequest): Record<string, unknown> => {
  const id = request.id === undefined || request.id === null ? '' : String(request.id);
  const name = request.name || '';
  const artist = request.artist || '';
  const album = request.album || '';
  return {
    id,
    songmid: id,
    songid: id,
    hash: request.hash || id,
    copyrightId: id,
    name,
    singer: artist,
    album,
    albumName: album,
    albumId: request.albumId || '',
    picId: request.picId === undefined || request.picId === null ? '' : String(request.picId),
    urlId: request.urlId === undefined || request.urlId === null ? '' : String(request.urlId),
    lyricId: request.lyricId === undefined || request.lyricId === null ? '' : String(request.lyricId),
    interval: 0,
    duration: 0,
    _types: request.qualityHashes ?? {},
  };
};

/** 判断某平台声明是否可用于解析（`local` 与未知键都不可用）。 */
export const declarationPlatform = (
  lxPlatform: string,
  declaration: LxSourceDeclaration,
): { appPlatform: string; actions: string[]; qualitys?: string[] } | null => {
  const appPlatform = toAppPlatform(lxPlatform);
  if (!appPlatform) return null;
  return {
    appPlatform,
    actions: declaration.actions ?? ['musicUrl'],
    qualitys: declaration.qualitys,
  };
};
