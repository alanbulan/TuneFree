import { BoundedCache } from '../utils/boundedCache';
import { parseLyrics } from '../utils/lyrics';
import { matchesLyricDuration, matchesLyricSongIdentity, sameLyricAlbum } from '../utils/lyrics/identity';
import { hasRealTimedWords, isLyricImprovement, isUsableSyncedLyric } from '../utils/lyrics/quality';
import { fetchLrcLibLyrics } from './lrcLib';
import { abortReasonError, firstSuccessfulWithConcurrency } from './resolverMatch';
import { fallbackPlatformsFor, resolveLyrics, searchSongs } from './sources/registry';
import { toSourceResolveRequest, type SourceResolveRequest } from './sources/types';
import { getPlaybackGeneration } from './sources/generation';

const cache = new BoundedCache<string, string>(200, 10 * 60_000);

/** 跨库歌词只补已核对时长的同一录音；只得到普通 LRC 时仍可正常逐行显示。 */
export const resolveLyricFallback = async (request: SourceResolveRequest, existing: string): Promise<string> => {
  if (request.signal?.aborted) throw abortReasonError(request.signal);
  if (hasRealTimedWords(parseLyrics(existing)) && isUsableSyncedLyric(existing, request.durationSeconds)) return existing;
  if (!request.name?.trim() || !request.artist?.trim()
    || !matchesLyricSongIdentity(request, request)
    || !Number.isFinite(request.durationSeconds) || (request.durationSeconds || 0) <= 0) return existing;
  const key = JSON.stringify([getPlaybackGeneration(), request.platform, request.id, request.lyricId,
    request.name, request.artist, request.durationSeconds, existing]);
  if (!request.forceRefresh) {
    const stored = cache.get(key);
    if (stored !== undefined) return stored;
  }
  let best = existing;
  await firstSuccessfulWithConcurrency(fallbackPlatformsFor(request.platform), 2, 6500,
    async (platform, signal) => {
      const candidates = (await searchSongs(`${request.name} ${request.artist}`, platform, 1, 6, signal))
        .filter((song) => matchesLyricSongIdentity(song, request)
          && matchesLyricDuration(song.durationSeconds, request.durationSeconds))
        .sort((left, right) => Number(sameLyricAlbum(right.album, request.album))
          - Number(sameLyricAlbum(left.album, request.album))).slice(0, 2);
      if (signal.aborted) return null;
      for (const song of candidates) {
        const candidate = await resolveLyrics(toSourceResolveRequest(song, request.quality,
          { signal, forceRefresh: request.forceRefresh }));
        if (signal.aborted) return null;
        if (!isLyricImprovement(best, candidate, request.durationSeconds)) continue;
        best = candidate;
        // 逐行补全先暂存，继续等其它来源的原生逐字；不能由首个普通 LRC 截断接力。
        if (hasRealTimedWords(parseLyrics(best))) return best;
      }
      return null;
    }, request.signal);
  if (!isUsableSyncedLyric(best, request.durationSeconds)) {
    const external = await fetchLrcLibLyrics(request);
    // 同平台给出的错版本整轨可以用经过严格身份和时长检查的免费记录替换。
    if (external) best = external;
  }
  if (request.signal?.aborted) throw abortReasonError(request.signal);
  cache.set(key, best);
  return best;
};
