
export interface Song {
  id: string | number;
  name: string;
  artist: string;
  album: string;
  pic?: string;
  url?: string;
  lrc?: string;
  source: 'netease' | 'qq' | 'kuwo' | string;
  types?: string[];
}

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