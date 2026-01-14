
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

// --- Stats API Types ---

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

// Endpoint #12 Data Structure
export interface OverallStats {
  period: string;
  overall: {
    total_calls: number;
    success_calls: number;
    success_rate: number;
    avg_duration: number; // Unique data point
  };
  breakdown: Array<{
    group_key: string;
    total_calls: number;
    success_rate: number;
  }>;
  qps: {
    avg_qps: number;
    peak_qps: number;
  };
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

export interface TrendPoint {
  date: string;
  total_calls: number;
  success_rate: number;
}

export interface TrendStats {
  trends: TrendPoint[];
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
