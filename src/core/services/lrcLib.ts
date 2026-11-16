import { BoundedCache } from '../utils/boundedCache';
import { matchesLyricDuration, matchesLyricSongIdentity, sameLyricAlbum } from '../utils/lyrics/identity';
import { isUsableSyncedLyric } from '../utils/lyrics/quality';
import { createLinkedAbort, throwIfAborted } from './proxy';
import type { SourceResolveRequest } from './sources/types';

const cache = new BoundedCache<string, string>(200, 30 * 60_000);
const missing = new BoundedCache<string, boolean>(200, 2 * 60_000);
const BASE = 'https://lrclib.net/api';

interface LrcLibRecord {
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string | null;
}

const requestJson = async (url: string, signal?: AbortSignal): Promise<unknown> => {
  const linked = createLinkedAbort(signal, 5000);
  try {
    // LRCLIB 提供 Access-Control-Allow-Origin:*，不经带用户配置的第三方 CORS 代理。
    const response = await fetch(url, { credentials: 'omit', signal: linked.signal });
    if (!response.ok) { await response.body?.cancel(); return null; }
    return await response.json();
  } catch {
    throwIfAborted(signal);
    return null;
  } finally { linked.cleanup(); }
};

const chooseLyrics = (records: unknown, request: SourceResolveRequest): string => {
  const rows = Array.isArray(records) ? records : [records];
  const valid = rows.filter((raw): raw is LrcLibRecord => {
    if (!raw || typeof raw !== 'object') return false;
    const row = raw as LrcLibRecord;
    return !row.instrumental && typeof row.syncedLyrics === 'string'
      && matchesLyricSongIdentity({ name: row.trackName, artist: row.artistName }, request)
      && matchesLyricDuration(row.duration, request.durationSeconds)
      && isUsableSyncedLyric(row.syncedLyrics, request.durationSeconds);
  });
  valid.sort((left, right) => Number(sameLyricAlbum(right.albumName, request.album))
    - Number(sameLyricAlbum(left.albumName, request.album))
    || Math.abs((left.duration as number) - (request.durationSeconds as number))
      - Math.abs((right.duration as number) - (request.durationSeconds as number)));
  // plainLyrics 与未经验证的 hasWordSync/lyricsfile 不转换成演唱逐字轨。
  return valid[0]?.syncedLyrics?.trim() || '';
};

/** 免费歌词兜底也必须核对歌名、歌手、版本与录音时长；没有时长时不猜第一条搜索结果。 */
export const fetchLrcLibLyrics = async (request: SourceResolveRequest): Promise<string> => {
  throwIfAborted(request.signal);
  if (!request.name?.trim() || !request.artist?.trim()
    || !matchesLyricSongIdentity(request, request)
    || !Number.isFinite(request.durationSeconds) || (request.durationSeconds || 0) <= 0) return '';
  const key = JSON.stringify([request.name, request.artist, request.album || '', request.durationSeconds]);
  if (!request.forceRefresh) {
    const stored = cache.get(key);
    if (stored !== undefined) return stored;
    if (missing.has(key)) return '';
  }
  const params = new URLSearchParams({ track_name: request.name, artist_name: request.artist,
    duration: String(Math.round(request.durationSeconds as number)) });
  if (request.album) params.set('album_name', request.album);
  let lyrics = chooseLyrics(await requestJson(`${BASE}/get?${params}`, request.signal), request);
  if (!lyrics) {
    params.delete('duration');
    params.delete('album_name');
    lyrics = chooseLyrics(await requestJson(`${BASE}/search?${params}`, request.signal), request);
  }
  throwIfAborted(request.signal);
  if (lyrics) { cache.set(key, lyrics); missing.delete(key); }
  else { cache.delete(key); missing.set(key, true); }
  return lyrics;
};
