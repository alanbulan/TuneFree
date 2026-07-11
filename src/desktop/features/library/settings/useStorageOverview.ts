import { useEffect, useMemo, useState } from 'react';
import type { Playlist, Song } from '../../../../core/types';
import {
  listOfflineDownloads,
  subscribeOfflineDownloads,
  type OfflineDownloadMeta,
} from '../../../../core/services/offlineDownloads';
import type { LlmConfigView } from '../../../../core/services/recommendation';
import type {
  StorageOverviewSegment,
  StorageOverviewStat,
} from '../components/StorageOverviewCard';

export const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
};

const getJsonByteLength = (value: unknown): number => {
  const content = JSON.stringify(value, null, 2);
  return new TextEncoder().encode(content).length;
};

const useOfflineDownloads = () => {
  const [downloads, setDownloads] = useState<OfflineDownloadMeta[]>([]);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const items = await listOfflineDownloads();
      if (!cancelled) setDownloads(items);
    };
    void refresh();
    const unsubscribe = subscribeOfflineDownloads(() => void refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return downloads;
};

export interface StorageOverview {
  totalLabel: string;
  totalValue: string;
  segments: StorageOverviewSegment[];
  stats: StorageOverviewStat[];
}

export function useStorageOverview(
  favorites: Song[],
  playlists: Playlist[],
  llmConfig: Pick<LlmConfigView, 'databaseSizeBytes' | 'llmCacheEntries'>,
): StorageOverview {
  const offlineDownloads = useOfflineDownloads();

  return useMemo(() => {
    const userPlaylists = playlists.filter((playlist) => playlist.id !== 'favorites');
    const playlistSongCount = userPlaylists.reduce((total, playlist) => total + playlist.songs.length, 0);
    const offlineAudioBytes = offlineDownloads.reduce((total, item) => total + Math.max(0, item.size || 0), 0);
    const downloadsJsonBytes = getJsonByteLength(offlineDownloads);
    const jsonBackupBytes = getJsonByteLength({
      version: 4,
      favorites,
      playlists: userPlaylists,
      exportDate: new Date().toISOString(),
    });
    const recommendationDbBytes = Math.max(0, llmConfig.databaseSizeBytes || 0);
    const totalBytes = offlineAudioBytes + recommendationDbBytes + jsonBackupBytes + downloadsJsonBytes;
    const segments: StorageOverviewSegment[] = [
      { id: 'offline-audio', label: '离线歌曲', value: offlineAudioBytes, formattedValue: formatBytes(offlineAudioBytes), color: '#2563eb' },
      { id: 'recommendation-db', label: '推荐数据库', value: recommendationDbBytes, formattedValue: formatBytes(recommendationDbBytes), color: '#10b981' },
      { id: 'library-backup', label: '收藏歌单备份', value: jsonBackupBytes, formattedValue: formatBytes(jsonBackupBytes), color: '#f59e0b' },
      { id: 'downloads-json', label: '下载索引 JSON', value: downloadsJsonBytes, formattedValue: formatBytes(downloadsJsonBytes), color: '#8b5cf6' },
    ];
    const stats: StorageOverviewStat[] = [
      { label: '离线歌曲', value: `${offlineDownloads.length} 首`, detail: formatBytes(offlineAudioBytes) },
      { label: '收藏', value: `${favorites.length} 首`, detail: `备份 ${formatBytes(jsonBackupBytes)}` },
      { label: '歌单', value: `${userPlaylists.length} 个`, detail: `${playlistSongCount} 首歌` },
      { label: '模型缓存', value: `${llmConfig.llmCacheEntries} 条`, detail: `推荐库 ${formatBytes(recommendationDbBytes)}` },
    ];
    return { totalLabel: '总占用', totalValue: formatBytes(totalBytes), segments, stats };
  }, [favorites, llmConfig.databaseSizeBytes, llmConfig.llmCacheEntries, offlineDownloads, playlists]);
}
