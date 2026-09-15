import type { Song, TopList } from '../../types';
import { abortReasonError } from '../resolverMatch';
import { normalizeMusicUrl } from '../musicUrl';
import {
  providerHandles,
  providerLists,
  providerSearches,
  type MusicProvider,
  type SourceResolveRequest,
} from './types';
import type { ParsedSongFull } from '../resolver';
import { BUILTIN_PROVIDERS } from './builtin';

/**
 * 通用解析器：**平台能力的唯一来源**。
 *
 * 这里不再出现任何写死的平台清单——每个 provider 自己声明它负责哪些平台、
 * 提供哪些能力（解析 / 歌词 / 封面 / 搜索 / 榜单）、以什么优先级参与，
 * resolver、搜索接口、界面选项、跨源兜底都从注册表派生。
 *
 * 优先级规则：
 * - 用户导入的自定义音源（kind = 'lx'）在它声明的平台上**独占**，不再回落内置 provider；
 * - 内置 provider 之间按 `priority`（解析）与 `lyricsPriority`（歌词）排序，
 *   GD 音乐台解析优先、原生歌词优先，与既有行为一致。
 */

export interface RegisteredProvider {
  provider: MusicProvider;
  platform: string;
}

let builtinProviders: MusicProvider[] = [...BUILTIN_PROVIDERS];
/** 内置脚本（例如 GD 音乐台）产出的 provider，与静态内置 provider 同等对待。 */
let builtinScriptProviders: RegisteredProvider[] = [];
let customProviders: RegisteredProvider[] = [];
let generation = 0;

/** 注册内置 provider（应用启动时调用一次）。 */
export const registerBuiltinProviders = (providers: MusicProvider[]): void => {
  builtinProviders = [...providers];
  generation += 1;
};

/** 由音源管理器在导入 / 启停 / 删除 / 重载后调用。 */
export const setCustomProviders = (entries: RegisteredProvider[]): void => {
  customProviders = entries;
  generation += 1;
};

/** 注册内置脚本产出的 provider（启动时一次、脚本重载时更新）。 */
export const setBuiltinScriptProviders = (entries: RegisteredProvider[]): void => {
  builtinScriptProviders = entries;
  generation += 1;
};

/** 内置 provider 全集（含内置脚本），按注册来源排序，优先级由调用方按需比较。 */
const allBuiltinProviders = (): MusicProvider[] => [
  ...builtinScriptProviders.map((entry) => entry.provider),
  ...builtinProviders,
];

/**
 * 音源配置代数。
 *
 * 播放链路的缓存（parsed-song cache）会把代数编进键，保证导入或停用音源后
 * 立即失效，而不是等 TTL 到期。
 */
export const getSourceGeneration = (): number => generation;

const customFor = (platform: string): MusicProvider[] =>
  customProviders
    .filter((entry) => providerHandles(entry.provider, platform))
    .map((entry) => entry.provider);

/** 自定义音源（跨源兜底与「按歌名匹配」用）。 */
export const getCustomProviders = (platform: string): MusicProvider[] => customFor(platform);

/** 所有显式允许按歌名匹配的自定义源。 */
export const getNameMatchCandidates = (): RegisteredProvider[] =>
  customProviders.filter((entry) => entry.provider.nameMatch === true);

/**
 * 某平台可用的 provider，按能力与优先级排好序。
 *
 * - `capability: 'url'`（解析）：自定义音源独占该平台，没有自定义源时按优先级走内置；
 * - `capability: 'metadata'`（歌词 / 封面）：自定义源优先，但**不独占**——
 *   自定义源没有的内容仍然可以回落到内置链路（原生歌词带翻译与逐字）。
 */
export const providersFor = (
  platform: string,
  capability: 'url' | 'metadata' = 'url',
): MusicProvider[] => {
  const custom = customFor(platform);
  const sortKey = (provider: MusicProvider): number =>
    capability === 'metadata'
      ? provider.lyricsPriority ?? provider.priority ?? 0
      : provider.priority ?? 0;
  const builtins = allBuiltinProviders()
    .filter((provider) => providerHandles(provider, platform))
    .sort((left, right) => sortKey(left) - sortKey(right));
  if (capability === 'metadata') return [...custom, ...builtins];
  return custom.length > 0 ? custom : builtins;
};

const finalize = (url: string): string => normalizeMusicUrl(url) || url;

/** 解析播放地址：自定义源独占，否则按优先级依次尝试（GD → 原生）。 */
export const resolveDirectUrl = async (
  request: SourceResolveRequest,
): Promise<string | null> => {
  for (const provider of providersFor(request.platform, 'url')) {
    if (!provider.getUrl) continue;
    try {
      const url = await provider.getUrl(request);
      if (url) return finalize(url);
    } catch (error) {
      if (request.signal?.aborted) throw abortReasonError(request.signal);
      console.warn(`[Sources] 音源解析失败（${provider.label} / ${request.platform}）：`, error);
    }
  }
  return null;
};

/** 歌词：自定义源优先，失败回落内置；取第一个非空结果。 */
export const resolveLyrics = async (request: SourceResolveRequest): Promise<string> => {
  for (const provider of providersFor(request.platform, 'metadata')) {
    if (!provider.getLyrics) continue;
    try {
      const lyrics = await provider.getLyrics(request);
      if (lyrics) return lyrics;
    } catch (error) {
      if (request.signal?.aborted) throw abortReasonError(request.signal);
      console.warn(`[Sources] 音源歌词失败（${provider.label}）：`, error);
    }
  }
  return '';
};

/** 封面：同样「自定义优先、内置兜底」（自定义源常把封面放在 pic action 里）。 */
export const resolvePic = async (request: SourceResolveRequest): Promise<string> => {
  for (const provider of providersFor(request.platform, 'metadata')) {
    if (!provider.getPic) continue;
    try {
      const pic = await provider.getPic(request);
      if (pic) return finalize(pic);
    } catch (error) {
      if (request.signal?.aborted) throw abortReasonError(request.signal);
      console.warn(`[Sources] 音源封面失败（${provider.label}）：`, error);
    }
  }
  return '';
};

/**
 * 整曲解析：交给第一个声明了 `resolveFull` 的 provider（GD 的 joox / bilibili
 * 就是这种「一次性拿 url + 歌词 + 封面」的模式），否则返回 null 由调用方走通用链路。
 */
export const resolveFull = async (
  request: SourceResolveRequest,
): Promise<ParsedSongFull | null> => {
  for (const provider of providersFor(request.platform, 'url')) {
    if (!provider.resolveFull) continue;
    try {
      const parsed = await provider.resolveFull(request);
      if (parsed) return parsed;
    } catch (error) {
      if (request.signal?.aborted) throw abortReasonError(request.signal);
      console.warn(`[Sources] 整曲解析失败（${provider.label}）：`, error);
    }
  }
  return null;
};

// ---------------------------------------------------------------- 搜索 / 榜单

const searchProviderFor = (platform: string): MusicProvider | null => {
  // providerSearches 已经按 searchPlatforms 判定归属，这里不要求 platforms 命中
  // （酷狗 / 咪咕只有一个「搜索 provider」，没有解析能力）。
  // 静态内置 provider 排在前面，保证搜索页平台顺序稳定。
  const candidates = [...customFor(platform), ...builtinProviders, ...builtinScriptProviders.map((entry) => entry.provider)];
  return candidates.find((provider) => providerSearches(provider, platform)) ?? null;
};

/** 搜索分发：按注册表找负责该平台的 provider。 */
export const searchSongs = async (
  keyword: string,
  platform: string,
  page: number,
  limit: number,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const provider = searchProviderFor(platform);
  if (!provider?.search) return [];
  return provider.search(keyword, platform, page, limit, signal);
};

/** 搜索页可选的平台列表（顺序即展示顺序，全部来自 provider 声明）。 */
export const searchablePlatforms = (): string[] => {
  const seen = new Set<string>();
  for (const provider of builtinProviders) {
    for (const platform of provider.searchPlatforms ?? []) seen.add(platform);
  }
  for (const entry of builtinScriptProviders) {
    for (const platform of entry.provider.searchPlatforms ?? []) seen.add(platform);
  }
  for (const entry of customProviders) {
    if (providerSearches(entry.provider, entry.platform)) seen.add(entry.platform);
  }
  return [...seen];
};

/** 聚合搜索的平台分组：core 一直参与，extended 由「扩展源」开关控制。 */
export const aggregatePlatforms = (includeExtended: boolean): string[] =>
  searchablePlatforms().filter((platform) => {
    const provider = searchProviderFor(platform);
    const tier = provider?.searchTier ?? 'core';
    return tier === 'core' || (tier === 'extended' && includeExtended);
  });

/** 该平台的解析是否依赖 GD 音乐台的公开接口（界面提示用）。 */
export const usesGDStudioQuota = (platform: string): boolean =>
  providersFor(platform, 'url').some((provider) => provider.gdStudioQuota === true);

/** 该平台的**搜索**是否占用 GD 公开接口频次（界面提示用）。 */
export const searchUsesGDStudioQuota = (platform: string): boolean =>
  searchProviderFor(platform)?.gdStudioQuota === true;

const topListProviderFor = (platform: string): MusicProvider | undefined =>
  [...customFor(platform), ...allBuiltinProviders()].find((provider) => providerLists(provider, platform));

export const getTopLists = async (platform: string): Promise<TopList[]> => {
  const provider = topListProviderFor(platform);
  return provider?.topLists ? provider.topLists(platform) : [];
};

export const getTopListDetail = async (
  id: string | number,
  platform: string,
): Promise<Song[]> => {
  const provider = topListProviderFor(platform);
  return provider?.topListDetail ? provider.topListDetail(id, platform) : [];
};

// ---------------------------------------------------------------- 跨源兜底

/**
 * 跨源兜底的候选平台（排除原平台）。
 *
 * provider 通过 `fallback` 声明参与方式：
 * - `true`：总是参与；
 * - `'with-custom'`：只有存在覆盖该平台的自定义音源时才参与。
 */
export const fallbackPlatformsFor = (originalSource: string): string[] => {
  const candidates: string[] = [];
  for (const platform of searchablePlatforms()) {
    if (platform === originalSource) continue;
    const provider = searchProviderFor(platform);
    const mode = provider?.fallback;
    if (mode === true) candidates.push(platform);
    else if (mode === 'with-custom' && customFor(platform).length > 0) candidates.push(platform);
  }
  return candidates;
};
