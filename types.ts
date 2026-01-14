export interface Song {
  id: string | number;
  name: string;
  artist: string;
  album: string;
  pic?: string; // Cover image URL
  url?: string; // Audio URL
  lrc?: string; // Lyric URL or text
  source: 'netease' | 'kuwo' | 'qq' | 'migu' | string; // Source platform
  duration?: number; // Optional, API doesn't always return this in lists
}

export interface LyricData {
  lrc: string; // The API returns plain text for type=lrc
}

export interface ParsedLyric {
  time: number;
  text: string;
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

// --- New Types for Stats API ---

export interface SystemHealth {
  status: string;
}

export interface StatsSummary {
  today: {
    total_calls: number;
    success_rate: number;
  };
  week: {
    total_calls: number;
  };
  top_platforms_today: { group_key: string; total_calls: number }[];
}

export interface PlatformStats {
  platforms: Record<string, { total_calls: number; success_rate: number }>;
}

export interface QpsStats {
  qps: {
    avg_qps: number;
    peak_qps: number;
    hourly_data: { date: string; hour: number; calls: number; qps: string }[];
  };
}

export interface RequestTypeStats {
  requestTypes: Record<string, { total_calls: number; success_rate: number }>;
}
