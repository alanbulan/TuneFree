
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
  lyricBundle?: {
    main?: string;
    translation?: string;
    romanization?: string;
    pronunciation?: string;
    karaoke?: string;
    source?: string;
  };
  lyricId?: string;
  source: 'netease' | 'qq' | 'kuwo' | string;
  /** 平台侧文件 hash（酷狗搜索得到，洛雪 kg 音源读 `musicInfo.hash`）。 */
  hash?: string;
  /** 平台侧专辑 id（部分音源接口按 albumId 取链接）。 */
  albumId?: string;
  /** QQ 媒体文件 MID，与歌曲 MID 不同，部分洛雪音源按它构造文件名。 */
  strMediaMid?: string;
  /** 音质 → hash 映射（洛雪 kg 音源读 `musicInfo._types`）。 */
  qualityHashes?: Record<string, { hash?: string; size?: number }>;
  types?: string[];
  recommendationReasons?: string[];
  recommendationSource?: 'local' | 'llm' | 'hybrid' | string;
  recommendationRequestId?: string;
  recommendationScore?: number;
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

export type { ParsedLyric } from "./utils/lyrics";

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
