
export interface Song {
  id: string | number;
  name: string;
  artist: string;
  album: string;
  pic?: string;
  picId?: string;
  url?: string;
  urlId?: string;
  lrc?: string;
  lyricId?: string;
  source: 'netease' | 'qq' | 'kuwo' | string;
  types?: string[];
}

export const getSongKey = (song: Pick<Song, 'id' | 'source'>): string =>
  `${String(song.source)}:${String(song.id)}`;

export const isSameSong = (
  a: Pick<Song, 'id' | 'source'> | null | undefined,
  b: Pick<Song, 'id' | 'source'> | null | undefined,
): boolean => {
  if (!a || !b) return false;
  return getSongKey(a) === getSongKey(b);
};

export type PlayMode = 'sequence' | 'loop' | 'shuffle';
export type AudioQuality = '128k' | '320k' | 'flac' | 'flac24bit';

export interface ParsedLyric {
  time: number;
  text: string;
  translation?: string;
}

export interface Playlist {
  id: string;
  name: string;
  createTime: number;
  songs: Song[];
}

export interface TopList {
  id: string | number;
  name: string;
  updateFrequency?: string;
  picUrl?: string;
  coverImgUrl?: string; // Netease often uses this
}

// TuneHub Method Configuration
export interface TuneHubMethod {
  type: 'http';
  method: 'GET' | 'POST';
  url: string;
  params?: Record<string, string>;
  body?: any;
  headers?: Record<string, string>;
  transform?: string;
}

export interface TuneHubResponse<T> {
  code: number;
  msg: string;
  data: T;
}
