import { BoundedCache } from '../../utils/boundedCache';
import { fetchNeteaseLyrics } from '../netease';
import { fetchQQLyrics } from '../qq';
import { fetchKuwoLyrics } from '../kuwo';
import { abortReasonError } from '../resolverMatch';

/**
 * 内置平台（网易 / QQ / 酷我）歌词：带缓存与 in-flight 去重。
 *
 * 从 `resolver.ts` 抽出，让原生 provider 自己拥有歌词能力；GD 歌词由 GD provider
 * 按优先级接力，因此这里不再包含任何 GD 分支。
 */

const LYRICS_CACHE_LIMIT = 200;
const LYRICS_CACHE_TTL_MS = 30 * 60_000;

const lyricsCache = new BoundedCache<string, string>(LYRICS_CACHE_LIMIT, LYRICS_CACHE_TTL_MS);
const lyricsPending = new Map<string, Promise<string>>();

interface NativeLyricsOptions {
  signal?: AbortSignal;
  forceRefresh?: boolean;
}

export const fetchNativeLyrics = async (
  id: string | number,
  source: string,
  options?: NativeLyricsOptions,
): Promise<string> => {
  const cacheKey = `lrc:${source}:${id}`;
  if (!options?.forceRefresh) {
    const cached = lyricsCache.get(cacheKey);
    if (cached !== undefined) return cached;

    // 可取消请求不共享 in-flight Promise，避免一次 abort 波及其它调用方。
    const pending = lyricsPending.get(cacheKey);
    if (pending && !options?.signal) return pending;
  }

  const request = (async () => {
    let lrc = '';
    try {
      if (source === 'netease') {
        lrc = await fetchNeteaseLyrics(id, options?.signal);
      } else if (source === 'qq') {
        lrc = await fetchQQLyrics(id, options?.signal);
      } else if (source === 'kuwo') {
        lrc = await fetchKuwoLyrics(id, options?.signal);
      }
    } catch (error) {
      if (options?.signal?.aborted) throw abortReasonError(options.signal);
      console.warn(`[Sources] 原生歌词获取失败 (${source}:${id}):`, error);
    } finally {
      if (!options?.signal) lyricsPending.delete(cacheKey);
    }

    if (lrc) lyricsCache.set(cacheKey, lrc);
    return lrc;
  })();

  if (!options?.signal) lyricsPending.set(cacheKey, request);
  return request;
};
