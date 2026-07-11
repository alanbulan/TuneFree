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

export const GD_STUDIO_MUSIC_SOURCES = [
  'netease',
  'qq',
  'kuwo',
  'tidal',
  'qobuz',
  'joox',
  'bilibili',
  'apple',
  'ytmusic',
  'spotify',
] as const;

export type GdStudioMusicSource = (typeof GD_STUDIO_MUSIC_SOURCES)[number];
export type GdStudioSource = GdStudioMusicSource;

export type CachedTrackMeta = {
  pic?: string;
  picId?: string;
  lyricId?: string;
  urlId?: string;
};

export const GD_STUDIO_SOURCES: readonly GdStudioSource[] = [
  ...GD_STUDIO_MUSIC_SOURCES,
];

export const GD_STUDIO_ONLY_SOURCES = [
  'tidal',
  'qobuz',
  'joox',
  'bilibili',
  'apple',
  'ytmusic',
  'spotify',
] as const;
export const URL_CACHE_TTL = 5 * 60 * 1000;

export const trackMetaCache = new Map<string, CachedTrackMeta>();
export const lyricCache = new Map<string, string>();
export const picCache = new Map<string, string>();
export const urlCache = new Map<string, { url: string; expiresAt: number }>();

export const toGDStudioApiSource = (source: GdStudioMusicSource): string =>
  source === 'qq' ? 'tencent' : source;

export const normalizeGDStudioSource = (source: unknown): GdStudioMusicSource | null => {
  const normalized = String(source || '').trim().toLowerCase();
  const canonical = normalized === 'tencent' ? 'qq' : normalized;
  return GD_STUDIO_MUSIC_SOURCES.includes(canonical as GdStudioMusicSource)
    ? canonical as GdStudioMusicSource
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
  trackMetaCache.set(cacheKey, { ...previous, ...meta });
};

export const resolveTrackMeta = (
  id: string | number,
  source: string,
): CachedTrackMeta => trackMetaCache.get(getTrackKey(id, source)) || {};
