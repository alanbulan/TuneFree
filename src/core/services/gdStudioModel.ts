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

export const GD_STUDIO_SOURCES: readonly GdStudioSource[] = [
  'netease',
  'kuwo',
  'joox',
  'bilibili',
  'qq',
  'embeat',
];
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
