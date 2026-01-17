
export interface Song {
  id: string | number;
  name: string;
  artist: string;
  album: string;
  pic?: string; // Cover image URL
  url?: string; // Audio URL
  lrc?: string; // Lyric URL or text
  source: 'netease' | 'kuwo' | 'qq' | string; // Source platform
  duration?: number; // Optional, API doesn't always return this in lists
  types?: string[]; // Available qualities: 128k, 320k, flac, flac24bit
}

export type PlayMode = 'sequence' | 'loop' | 'shuffle';
export type AudioQuality = '128k' | '320k' | 'flac' | 'flac24bit';

export interface LyricData {
  lrc: string; // The API returns plain text for type=lrc
}

export interface ParsedLyric {
  time: number;
  text: string;
  translation?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  createTime: number;
  songs: Song[];
}

export interface TopList {
  id: string | number;
  name: string;
  updateFrequency?: string;
  picUrl?: string; // Optional if we want to show icons
}

// --- Stats API Types (Retained minimal health types if needed, others removed) ---

export interface SystemHealth {
  status: string;
  msg?: string;
  data?: any;
}

export interface SystemStatus {
    version?: string;
    uptime?: number;
    memory?: {
        rss: number;
        heapTotal: number;
        heapUsed: number;
    };
    load?: number[];
    [key: string]: any;
}
