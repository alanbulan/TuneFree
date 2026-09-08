import { invokeCommand } from '../ipc/commands';
import { isTauri } from '../ipc/env';
import { convertFileSrc } from '../ipc/windows';
import type { OfflineDownloadMeta } from '../ipc/types';
import type { AudioQuality, Song } from '../types';
import { getSongKey } from '../types';
import { normalizeMusicUrl } from './musicUrl';

// ==============================
// 本地文件下载管理（基于磁盘文件 + downloads.json 元数据）
// 不再使用 IndexedDB 存储 Blob，直接读取磁盘文件播放。
// downloads.json 保存在下载目录，记录每首歌的元数据。
// 下载目录由后端唯一管理（已授权目录 / 默认目录），前端不再回传路径。
// ==============================

export type { OfflineDownloadMeta };

export interface OfflinePlayback {
  url: string;
  lrc: string;
  pic: string;
  quality: string;
}

// ==============================
// 变更通知（下载/删除后让 UI 刷新）
// ==============================

type OfflineListener = () => void;
const listeners = new Set<OfflineListener>();

export const subscribeOfflineDownloads = (
  listener: OfflineListener,
): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notifyOfflineChanged = () => {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
};

// ==============================
// 查询
// ==============================

export const listOfflineDownloads = async (): Promise<OfflineDownloadMeta[]> => {
  if (!isTauri()) return [];
  return invokeCommand('scan_download_dir');
};

// ==============================
// 本地优先播放解析
// 查找磁盘上的已下载文件，通过 convertFileSrc 转为可播放 URL。
// ==============================

export const resolveOfflinePlayback = async (
  song: Song,
  quality: AudioQuality | string,
): Promise<OfflinePlayback | null> => {
  if (!isTauri()) return null;

  try {
    const result = await invokeCommand('resolve_local_playback', {
      songId: String(song.id),
      source: song.source,
      quality: String(quality),
    });

    if (!result?.filepath) return null;

    const url = convertFileSrc(result.filepath);
    const songMeta = result.song;

    return {
      url,
      lrc: song.lrc || songMeta?.lrc || '',
      pic: normalizeMusicUrl(song.pic || songMeta?.pic),
      quality: result.quality,
    };
  } catch {
    return null;
  }
};

// ==============================
// 删除
// ==============================

export const deleteOfflineDownload = async (filename: string): Promise<void> => {
  if (!isTauri()) return;

  await invokeCommand('delete_download_file', { filename });

  notifyOfflineChanged();
};

// ==============================
// 工具函数
// ==============================

export const formatOfflineSize = (size: number): string => {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${size} B`;
};

export { getSongKey };
