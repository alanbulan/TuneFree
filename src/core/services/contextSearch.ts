import { invokeCommand } from '../ipc/commands';
import { isTauri } from '../ipc/env';
import type { ContextSongSuggestion } from '../ipc/types';
import type { Song } from '../types';
import { CircuitOpenError } from './sources/circuitBreaker';
import { liveSearchPlatforms, searchSongs } from './sources/registry';

/**
 * 语境搜歌（「这一刻，想听什么？」）。
 *
 * 分两步，职责严格分开：
 * 1. **模型只出歌名 + 歌手**（Rust `search_songs_by_context`，走用户自己配置的
 *    OpenAI 兼容服务）；
 * 2. **歌曲数据全部来自真实平台**：拿歌名歌手走应用统一的多音源搜索注册表，
 *    因此封面、平台 id、可播放地址与搜索页完全同源。
 *
 * 这么拆是为了根治两个老问题：
 * - 封面出不来：过去走 GD 的 `embeat_agent` / Pollinations，拿到的是模型臆造或
 *   GD 专属的 pic_id，跟应用的多音源封面链路对不上；
 * - 数据源单一：过去固定只搜 netease，现在按注册表跨平台搜索并择优。
 */

/** 每首推荐最多搜多少个平台，避免一次语境搜歌打出几十个请求。 */
const MAX_PLATFORMS_PER_SONG = 3;
/** 单个平台每首歌取多少条候选参与匹配打分。 */
const CANDIDATES_PER_PLATFORM = 5;
/** 并发解析多少首推荐。 */
const RESOLVE_CONCURRENCY = 4;

const normalize = (value: string): string => value
  .toLowerCase()
  .replace(/[（([【].*?[)）\]】]/g, '')
  .replace(/[\s·・.。\-_—–,，、/\\|:：'"]+/g, '')
  .trim();
/** 歌名匹配度：完全相等最高，互相包含次之，其余不合格。 */
const nameScore = (candidate: string, expected: string): number => {
  const left = normalize(candidate);
  const right = normalize(expected);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.6;
  return 0;
};

/** 歌手匹配度：允许「A/B」「A、B」这类多歌手写法里命中其一。 */
const artistScore = (candidate: string, expected: string): number => {
  const left = normalize(candidate);
  const right = normalize(expected);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.7;
  return 0;
};

/**
 * 在候选里挑最像的一首。
 *
 * 歌名不合格直接淘汰：宁可这首推荐落空，也不要把一首完全不相干的歌塞给用户。
 */
const pickBestMatch = (
  candidates: Song[],
  suggestion: ContextSongSuggestion,
): { song: Song; score: number } | null => {
  let best: { song: Song; score: number } | null = null;
  for (const song of candidates) {
    const name = nameScore(String(song.name || ''), suggestion.name);
    if (name === 0) continue;
    const artist = artistScore(String(song.artist || ''), suggestion.artist);
    // 有封面的略微加权：语境搜歌的结果直接进歌单，封面缺失观感差。
    const score = name * 2 + artist + (song.pic ? 0.2 : 0);
    if (!best || score > best.score) best = { song, score };
  }
  return best;
};

/** 搜索平台顺序：注册表里还可用的平台，网易云/QQ/酷我优先（覆盖面最广）。 */
const resolveOrder = (): string[] => {
  const preferred = ['netease', 'qq', 'kuwo'];
  const available = liveSearchPlatforms();
  return [
    ...preferred.filter((platform) => available.includes(platform)),
    ...available.filter((platform) => !preferred.includes(platform)),
  ].slice(0, MAX_PLATFORMS_PER_SONG);
};

/**
 * 把一条模型建议解析成真实歌曲。
 *
 * 按平台顺序逐个搜：拿到高置信匹配（歌名完全相等）就收工，否则继续找更好的，
 * 全部搜完仍只有低置信匹配时也接受 —— 总比丢掉这首推荐好。
 */
const resolveSuggestion = async (
  suggestion: ContextSongSuggestion,
  platforms: string[],
  signal?: AbortSignal,
): Promise<Song | null> => {
  let best: { song: Song; score: number } | null = null;
  for (const platform of platforms) {
    if (signal?.aborted) return null;
    try {
      const candidates = await searchSongs(
        `${suggestion.name} ${suggestion.artist}`,
        platform,
        1,
        CANDIDATES_PER_PLATFORM,
        signal,
      );
      const match = pickBestMatch(candidates, suggestion);
      if (match && (!best || match.score > best.score)) best = match;
      // 歌名与歌手都完全命中，没必要再问下一个平台。
      if (best && best.score >= 3) break;
    } catch (error) {
      // 单个平台失败不影响其他平台；熔断器已在注册表侧登记这次失败，
      // 若该平台已熔断，下一轮 resolveOrder 就会把它排除。
      if (error instanceof CircuitOpenError) continue;
    }
  }
  if (!best) return null;
  return { ...best.song, recommendationReasons: [suggestion.reason] };
};

/** 固定并发跑一批任务，避免一次语境搜歌把请求全放出去。 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = Array.from({ length: items.length }, () => undefined as unknown as R);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
};

export class ContextSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextSearchUnavailableError';
  }
}

/**
 * 按场景 / 心情生成歌单。
 *
 * @throws ContextSearchUnavailableError 未配置模型或模型服务不可用。
 */
export const searchSongsByContext = async (
  keyword: string,
  limit = 12,
  signal?: AbortSignal,
): Promise<Song[]> => {
  const query = keyword.trim();
  if (!query) return [];
  if (!isTauri()) {
    throw new ContextSearchUnavailableError('语境搜歌需要在桌面应用中使用');
  }
  const suggestions = await invokeCommand('search_songs_by_context', { keyword: query, limit });
  if (signal?.aborted || suggestions.length === 0) return [];
  const platforms = resolveOrder();
  if (platforms.length === 0) {
    throw new ContextSearchUnavailableError('当前没有可用的搜索音源');
  }
  const resolved = await mapWithConcurrency(
    suggestions,
    RESOLVE_CONCURRENCY,
    (suggestion) => resolveSuggestion(suggestion, platforms, signal),
  );
  // 保持模型给出的推荐顺序，同一首歌只保留一次。
  const seen = new Set<string>();
  const songs: Song[] = [];
  for (const song of resolved) {
    if (!song) continue;
    const key = `${song.source}:${song.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(song);
  }
  return songs;
};
