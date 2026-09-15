import { BoundedCache } from '../../utils/boundedCache';
import { mergeLyricTracks } from '../../utils/lyrics';
import { throwIfAborted } from '../proxy';
import type { Song } from '../../types';
import { buildMusicInfo, pickQuality } from './platformMap';
import type { LxSourceDeclaration } from './protocol';
import type { MusicProvider, SourceResolveRequest } from './types';
import type { LxSandbox } from './workerHost';
import { readSourceUrl } from './diagnostics';

/** 解析结果缓存时长（与 GD 的 urlCache 对齐）。 */
const URL_CACHE_TTL_MS = 5 * 60_000;
const URL_CACHE_LIMIT = 200;

export interface LxProviderInput {
  scriptId: string;
  scriptName: string;
  /** 应用侧平台键（netease / qq / kuwo / kugou / migu）。 */
  appPlatform: string;
  /** 洛雪平台键（wy / tx / kw / kg / mg）。 */
  lxPlatform: string;
  declaration: LxSourceDeclaration;
  sandbox: LxSandbox;
  /** 是否允许按歌名匹配（缺 id 的跨源兜底），默认关闭。 */
  nameMatchFallback: boolean;
  // 以下字段供「内置脚本」使用：用户脚本走自定义独占规则，不需要优先级。
  priority?: number;
  lyricsPriority?: number;
  fallback?: boolean | 'with-custom';
  searchTier?: 'core' | 'extended';
  gdStudioQuota?: boolean;
  /** GD 等内置脚本可独立查询歌词和封面，无需先消耗一次 URL 请求。 */
  metadataRequiresUrl?: boolean;
}

/**
 * 把脚本返回的歌词还原成应用使用的单条 LRC。
 *
 * 洛雪协议里 `lyric` action 可以返回 `{ lyric, tlyric, rlyric }`，这里复用应用的
 * 合并逻辑（翻译 / 罗马音 / 逐字）拼成一条，和内置平台的歌词格式保持一致。
 */
const extractLyric = (result: unknown, source: string): string => {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const record = result as Record<string, unknown>;
  const pick = (fields: readonly string[]): string => {
    for (const field of fields) {
      const value = record[field];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  };
  const main = pick(['lyric', 'lrc', 'lrcx']);
  const translation = pick(['tlyric', 'trans', 'translation', 'translations']);
  const romanization = pick(['rlyric', 'romalrc', 'roma', 'romanization']);
  const pronunciation = pick(['pronunciation']);
  const karaoke = pick(['karaoke', 'qrc', 'yrc', 'krc', 'klyric', 'mrc']);
  if (!main && !translation && !romanization && !pronunciation && !karaoke) return '';
  if (!translation && !romanization && !pronunciation && !karaoke) return main;
  return mergeLyricTracks({ main, translation, romanization, pronunciation, karaoke, source });
};

/** 校验并收窄脚本返回的搜索结果（只有 id + name 是硬性要求）。 */
const extractSong = (raw: unknown, fallbackSource: string): Song | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
  const id = record.id === undefined || record.id === null ? '' : String(record.id).trim();
  const name = text(record.name);
  if (!id || !name) return null;
  const pic = text(record.pic);
  const picId = text(record.picId);
  const lyricId = text(record.lyricId);
  const urlId = text(record.urlId);
  return {
    id,
    name,
    artist: text(record.artist),
    album: text(record.album),
    ...(pic ? { pic } : {}),
    ...(picId ? { picId } : {}),
    ...(lyricId ? { lyricId } : {}),
    ...(urlId ? { urlId } : {}),
    source: text(record.source) || fallbackSource,
  };
};

/**
 * 单个（脚本 × 平台）的 provider。
 *
 * 洛雪脚本的歌词与封面常常是 `musicUrl` 的副作用（脚本内部缓存了上一次解析的
 * 附带信息），因此 `getLyrics` / `getPic` 会先确保同一个 (id, 音质) 已经跑过
 * `musicUrl`，否则拿到空结果。
 */
export const createLxProvider = (input: LxProviderInput): MusicProvider => {
  const actions = new Set(input.declaration.actions ?? ['musicUrl']);
  const urlCache = new BoundedCache<string, { url: string; expiresAt: number }>(
    URL_CACHE_LIMIT,
    URL_CACHE_TTL_MS,
  );
  const urlRequested = new BoundedCache<string, boolean>(URL_CACHE_LIMIT, URL_CACHE_TTL_MS);
  // 仅共享同一取消信号的请求，播放和预加载不会相互取消。
  const pendingUrls = new Map<string, Map<AbortSignal | undefined, Promise<string | null>>>();
  const keyOf = (request: SourceResolveRequest): string => JSON.stringify([
    String(request.id).trim() || [request.name || '', request.artist || '', request.album || ''],
    request.quality,
  ]);

  const resolveUrl = async (request: SourceResolveRequest): Promise<string | null> => {
    throwIfAborted(request.signal);
    if (!actions.has('musicUrl')) return null;
    const quality = pickQuality(request.quality, input.declaration.qualitys);
    // 脚本声明了空的音质列表，说明该平台不提供可用链接。
    if (quality === null) return null;

    const key = keyOf(request);
    if (!request.forceRefresh) {
      const cached = urlCache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        urlRequested.set(key, true);
        return cached.url;
      }
    }

    let pending = pendingUrls.get(key);
    const existing = pending?.get(request.signal);
    if (existing) return existing;
    if (!pending) pendingUrls.set(key, (pending = new Map()));
    if (request.forceRefresh) urlCache.delete(key);
    const resolution = (async () => {
      const outcome = await input.sandbox.call(
        input.lxPlatform,
        'musicUrl',
        { type: quality, musicInfo: buildMusicInfo(request) },
        { signal: request.signal },
      );
      throwIfAborted(request.signal);
      urlRequested.set(key, true);
      if (!outcome.ok) throw new Error(outcome.error || '音源解析失败');
      const url = readSourceUrl(outcome.result);
      if (!url) throw new Error('解析结果格式错误：未返回有效的 HTTP(S) 播放地址');
      if (url) urlCache.set(key, { url, expiresAt: Date.now() + URL_CACHE_TTL_MS });
      return url;
    })();
    pending.set(request.signal, resolution);
    try {
      return await resolution;
    } finally {
      pending.delete(request.signal);
      if (pending.size === 0) pendingUrls.delete(key);
    }
  };

  const ensureUrlRequested = async (request: SourceResolveRequest): Promise<void> => {
    if (input.metadataRequiresUrl === false || !actions.has('musicUrl')) return;
    const key = keyOf(request);
    if (urlRequested.has(key)) return;
    try {
      await resolveUrl(request);
    } catch {
      // 附带信息拿不到不影响主流程；错误已经记在沙箱状态里。
    }
  };

  const callWithFallbackGate = async (
    action: 'lyric' | 'pic',
    request: SourceResolveRequest,
  ): Promise<unknown> => {
    throwIfAborted(request.signal);
    if (!actions.has(action)) return null;
    await ensureUrlRequested(request);
    throwIfAborted(request.signal);
    const outcome = await input.sandbox.call(
      input.lxPlatform,
      action,
      { musicInfo: buildMusicInfo(request), type: pickQuality(request.quality, input.declaration.qualitys) },
      { signal: request.signal },
    );
    return outcome.ok ? outcome.result : null;
  };

  const supportsSearch = actions.has('search');

  return {
    kind: 'lx',
    id: `lx:${input.scriptId}:${input.lxPlatform}`,
    label: input.scriptName,
    platforms: [input.appPlatform],
    // 只有声明了 search 的脚本才参与搜索（洛雪协议本身没有搜索，这是我们的扩展）
    ...(supportsSearch ? { searchPlatforms: [input.appPlatform] } : {}),
    nameMatch: input.nameMatchFallback,
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.lyricsPriority === undefined ? {} : { lyricsPriority: input.lyricsPriority }),
    ...(input.fallback === undefined ? {} : { fallback: input.fallback }),
    ...(input.searchTier === undefined ? {} : { searchTier: input.searchTier }),
    ...(input.gdStudioQuota === undefined ? {} : { gdStudioQuota: input.gdStudioQuota }),
    getUrl: async (request) => {
      const hasId = String(request.id ?? '').trim().length > 0;
      if (!hasId && !input.nameMatchFallback) return null;
      return resolveUrl(request);
    },
    getLyrics: async (request) =>
      extractLyric(await callWithFallbackGate('lyric', request), input.appPlatform),
    getPic: async (request) => readSourceUrl(await callWithFallbackGate('pic', request)) ?? '',
    ...(supportsSearch
      ? {
          search: async (keyword: string, _platform: string, page: number, limit: number, signal?: AbortSignal) => {
            const outcome = await input.sandbox.call(
              input.lxPlatform,
              'search',
              { keyword, page, limit },
              { signal },
            );
            if (!outcome.ok) throw new Error(outcome.error || '音源搜索失败');
            const list = Array.isArray(outcome.result) ? outcome.result : [];
            return list
              .map((item) => extractSong(item, input.appPlatform))
              .filter((song): song is Song => song !== null);
          },
        }
      : {}),
  };
};
