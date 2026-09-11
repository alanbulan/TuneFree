import { getSongKey, type Playlist, type Song } from '../types';
import { normalizeMusicUrl } from '../services/musicUrl';
import {
  backupCorruptStorage,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from '../utils/safeStorage';
import { stripRuntimeSongFields } from '../services/songStorage';

export interface LibraryBackup {
  favorites: Song[];
  playlists: Playlist[];
}

export interface LibraryImportPreview {
  version?: number;
  favorites: Song[];
  playlists: Playlist[];
  favoriteCount: number;
  playlistCount: number;
  playlistSongCount: number;
}

export type LibraryImportMode = 'replace' | 'merge';
export type LibraryImportResult =
  | { ok: true; data: LibraryImportPreview }
  | { ok: false; error: string };
export type LibraryExportResult =
  | { ok: true; filename: string }
  | { ok: false; error: string };
export type LibraryApplyImportResult =
  | { ok: true; backup: LibraryBackup }
  | { ok: false; error: string };

export const DEFAULT_PROXY = '';
export const FAVORITES_KEY = 'tunefree_favorites';
export const PLAYLISTS_KEY = 'tunefree_playlists';
export const CORS_PROXY_KEY = 'tunefree_cors_proxy';
export const LIBRARY_KEY = 'tunefree_library';
export const LIBRARY_SAVE_ERROR = '曲库保存失败，请检查可用存储空间；本次更改未生效';
/** 伪歌单「我喜欢」的固定 ID，addToPlaylist / removeFromPlaylist 会转发到收藏。 */
export const FAVORITES_PLAYLIST_ID = 'favorites';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getString = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

export const normalizeSong = (value: unknown): Song | null => {
  if (!isRecord(value)) return null;
  const { id, source } = value;
  if (
    (typeof id !== 'string' && typeof id !== 'number') ||
    typeof source !== 'string' ||
    !source
  ) {
    return null;
  }
  const song = {
    ...value,
    id,
    source,
    name: getString(value.name, '未知歌曲'),
    artist: getString(value.artist, '未知歌手'),
    album: getString(value.album, '未知专辑'),
  } as Song;
  for (const key of ['pic', 'picId', 'url', 'urlId', 'lrc', 'lyricId'] as const) {
    if (value[key] !== undefined && typeof value[key] !== 'string') delete song[key];
  }
  if (value.types !== undefined && !Array.isArray(value.types)) delete song.types;
  if (song.pic) song.pic = normalizeMusicUrl(song.pic);
  return song;
};

export const uniqueSongs = (songs: Song[]) => {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = getSongKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

/** 不是数组返回 null，让调用方能区分「空」与「损坏」。 */
export const normalizeSongArray = (value: unknown): Song[] | null => {
  if (!Array.isArray(value)) return null;
  return uniqueSongs(
    value.map(normalizeSong).filter((song): song is Song => Boolean(song)),
  );
};

const normalizePlaylist = (value: unknown): Playlist | null => {
  if (!isRecord(value)) return null;
  const songs = normalizeSongArray(value.songs);
  if (typeof value.id !== 'string' || !value.id || typeof value.name !== 'string' || !songs) {
    return null;
  }
  return {
    id: value.id,
    name: value.name,
    createTime:
      typeof value.createTime === 'number' && Number.isFinite(value.createTime)
        ? value.createTime
        : Date.now(),
    songs,
  };
};

export const normalizePlaylistArray = (value: unknown): Playlist[] | null => {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  return value
    .map(normalizePlaylist)
    .filter((playlist): playlist is Playlist => Boolean(playlist))
    .filter((playlist) => !seen.has(playlist.id) && Boolean(seen.add(playlist.id)));
};

// ==============================
// 存储读写（全部走 safeStorage，容错配额/隐私模式）
// ==============================

export const getStoredValue = (key: string, fallback: string): string =>
  safeGetItem(key, fallback) ?? fallback;
export const setStoredValue = (key: string, value: string): boolean => safeSetItem(key, value);
export const removeStoredValue = (key: string): boolean => safeRemoveItem(key);

/** 损坏数据备份后必须移除原键，否则每次启动都会再备份一份，最终把配额撑爆。 */
const quarantineCorruptValue = (key: string, rawValue: string): void => {
  try {
    backupCorruptStorage(key, rawValue);
    removeStoredValue(key);
  } catch (error) {
    console.warn('备份损坏的本地数据失败', error);
  }
};

export const getStoredJson = <T>(
  key: string,
  fallback: T,
  normalize: (value: unknown) => T | null,
): T => {
  const rawValue = safeGetItem(key, null);
  if (!rawValue) return fallback;
  try {
    const normalized = normalize(JSON.parse(rawValue));
    if (normalized) return normalized;
  } catch (error) {
    console.warn(`读取本地数据失败: ${key}`, error);
  }
  quarantineCorruptValue(key, rawValue);
  return fallback;
};

export const mergeSongLists = (base: Song[], incoming: Song[]) =>
  uniqueSongs([...base, ...incoming]);

export const mergePlaylists = (base: Playlist[], incoming: Playlist[]) => {
  const byId = new Map(base.map((playlist) => [playlist.id, playlist]));
  for (const playlist of incoming) {
    const existing = byId.get(playlist.id);
    byId.set(
      playlist.id,
      existing
        ? { ...existing, songs: mergeSongLists(existing.songs, playlist.songs) }
        : playlist,
    );
  }
  return Array.from(byId.values());
};

// ==============================
// 导入 / 导出
// ==============================

export const parseLibraryImport = (jsonData: string): LibraryImportResult => {
  try {
    const data: unknown = JSON.parse(jsonData);
    if (!isRecord(data)) return { ok: false, error: '导入文件不是有效的 TuneFree JSON' };
    if (!('favorites' in data) && !('playlists' in data)) {
      return { ok: false, error: '导入文件缺少收藏或歌单数据' };
    }
    const favorites = 'favorites' in data ? normalizeSongArray(data.favorites) : [];
    const playlists = 'playlists' in data ? normalizePlaylistArray(data.playlists) : [];
    if (!favorites || !playlists) return { ok: false, error: '导入文件结构不正确，未修改现有数据' };
    return {
      ok: true,
      data: {
        version: typeof data.version === 'number' ? data.version : undefined,
        favorites,
        playlists,
        favoriteCount: favorites.length,
        playlistCount: playlists.length,
        playlistSongCount: playlists.reduce(
          (total, playlist) => total + playlist.songs.length,
          0,
        ),
      },
    };
  } catch {
    return { ok: false, error: 'JSON 解析失败，未修改现有数据' };
  }
};

export const exportLibraryData = (
  favorites: Song[],
  playlists: Playlist[],
): LibraryExportResult => {
  if (typeof document === 'undefined') return { ok: false, error: '当前环境不支持导出' };
  const filename = `tunefree_backup_${new Date().toISOString().slice(0, 10)}.json`;
  let url = '';
  try {
    const payload = {
      version: 4,
      favorites: favorites.map(stripRuntimeSongFields),
      playlists: playlists.map((playlist) => ({
        ...playlist,
        songs: playlist.songs.map(stripRuntimeSongFields),
      })),
      exportDate: new Date().toISOString(),
    };
    url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    );
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    return { ok: true, filename };
  } catch {
    return { ok: false, error: '导出失败，请稍后再试' };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
};
