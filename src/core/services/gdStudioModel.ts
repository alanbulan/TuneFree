import { BoundedCache } from '../utils/boundedCache';
export type GdStudioTrack = {
  id?: string | number;
  name?: string;
  artist?: string[] | string;
  album?: string;
  pic_id?: string;
  url_id?: string;
  lyric_id?: string;
  source?: string;
};

export type GdStudioSource = 'netease' | 'kuwo' | 'joox' | 'bilibili' | 'qq' | 'embeat';

export type CachedTrackMeta = {
  pic?: string;
  picId?: string;
  lyricId?: string;
  urlId?: string;
};

export const GD_STUDIO_SOURCES: readonly GdStudioSource[] = [
  'netease',
  'kuwo',
  'joox',
  'bilibili',
  'qq',
  'embeat',
];

export const GD_STUDIO_ONLY_SOURCES = ['joox', 'bilibili'] as const;
export const URL_CACHE_TTL = 5 * 60 * 1000;

export const trackMetaCache = new BoundedCache<string, CachedTrackMeta>(1000, 30 * 60_000);
export const lyricCache = new BoundedCache<string, string>(200, 30 * 60_000);
export const picCache = new BoundedCache<string, string>(500, 30 * 60_000);
export const urlCache = new BoundedCache<string, { url: string; expiresAt: number }>(200, URL_CACHE_TTL);

export const buildJooxCoverUrl = (picId: string, size: 300 | 500 = 500): string =>
  `https://image.joox.com/JOOXcover/0/${picId}/${size}`;

export const toGDStudioApiSource = (source: string): string =>
  source === 'qq' ? 'tencent' : source;

export const normalizeGDStudioSource = (source: unknown): GdStudioSource | null => {
  const normalized = String(source || '').trim().toLowerCase();
  const canonical = normalized === 'tencent' ? 'qq' : normalized;
  return GD_STUDIO_SOURCES.includes(canonical as GdStudioSource)
    ? canonical as GdStudioSource
    : null;
};

export const getTrackKey = (id: string | number, source: string): string =>
  `${source}:${String(id)}`;

export const getUrlCacheKey = (
  id: string | number,
  source: string,
  quality: string,
): string => `${source}:${String(id)}:${quality}`;

export const joinArtists = (artist: string[] | string | undefined): string => {
  if (Array.isArray(artist)) return artist.join(', ');
  return typeof artist === 'string' ? artist : '';
};

export const normalizeBitrate = (quality: string): string => {
  if (quality === '128k') return '128';
  if (quality === '320k') return '320';
  if (quality === 'flac') return '740';
  if (quality === 'flac24bit') return '999';
  return '320';
};

export const rememberTrackMeta = (
  id: string | number,
  source: string,
  meta: CachedTrackMeta,
): void => {
  const cacheKey = getTrackKey(id, source);
  const previous = trackMetaCache.get(cacheKey) || {};
  const next = { ...previous };
  for (const field of ['pic', 'picId', 'lyricId', 'urlId'] as const) {
    if (typeof meta[field] === 'string' && meta[field]) next[field] = meta[field];
  }
  trackMetaCache.set(cacheKey, next);
};

export const resolveTrackMeta = (
  id: string | number,
  source: string,
): CachedTrackMeta => trackMetaCache.get(getTrackKey(id, source)) || {};
