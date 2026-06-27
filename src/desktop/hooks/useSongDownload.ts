import { useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getSongUrl, triggerDownload } from '../../core/services/api';
import { downloadSongOffline } from '../../core/services/offlineDownloads';
import type { AudioQuality, Song } from '../../core/types';
import { useDownloadProgress } from './useDownloadProgress';
import { useToast } from '../components/ToastHost';

const downloadMeta: Record<string, { label: string; ext: string }> = {
  '128k': { label: '128K', ext: 'mp3' },
  '320k': { label: '320K', ext: 'mp3' },
  flac: { label: 'FLAC', ext: 'flac' },
  flac24bit: { label: 'Hi-Res', ext: 'flac' },
};

export const qualityOptions: AudioQuality[] = ['128k', '320k', 'flac', 'flac24bit'];

export function getDownloadMeta(quality: AudioQuality) {
  return downloadMeta[quality] || { label: quality.toUpperCase(), ext: 'mp3' };
}

interface UseSongDownloadResult {
  /** The quality currently being downloaded, or null when idle. */
  downloadQuality: AudioQuality | null;
  /** Live progress percentage (0–100) or null when not downloading. */
  downloadProgress: number | null;
  /** Whether a download is in progress (convenience flag). */
  isDownloading: boolean;
  /** Start downloading `song` at the given `quality`. */
  handleDownload: (song: Song, quality: AudioQuality) => Promise<void>;
}

/**
 * Shared download logic used by both DesktopTransport and DesktopFullPlayer.
 * Encapsulates URL resolution, Tauri / browser download dispatch, and
 * offline-library caching.
 */
export function useSongDownload(): UseSongDownloadResult {
  const { showToast } = useToast();
  const eventProgress = useDownloadProgress();
  const [downloadQuality, setDownloadQuality] = useState<AudioQuality | null>(null);
  const [localProgress, setLocalProgress] = useState<number | null>(null);

  // When a download is active, prefer the event-driven progress; otherwise null.
  const downloadProgress = downloadQuality !== null ? eventProgress ?? localProgress : null;

  const handleDownload = useCallback(
    async (song: Song, quality: AudioQuality) => {
      if (downloadQuality) return;

      setDownloadQuality(quality);
      setLocalProgress(0);
      try {
        const url = await getSongUrl(song.id, song.source, quality, song);
        if (!url) {
          showToast('无法获取下载地址', 'error');
          setLocalProgress(null);
          return;
        }

        const meta = getDownloadMeta(quality);
        const filename = `${song.artist} - ${song.name}.${meta.ext}`;

        const isTauri =
          typeof window !== 'undefined' &&
          '__TAURI_INTERNALS__' in window;

        if (isTauri) {
          const customDir = localStorage.getItem('tunefree_download_dir') || null;
          await invoke('download_song_to_local', { url, filename, customDir });
          try {
            await downloadSongOffline(song, quality);
          } catch (e) {
            console.error('写入离线库失败', e);
          }
          showToast('下载成功，已保存至本地下载目录并加入离线库', 'success');
        } else {
          triggerDownload(url, filename);
          try {
            await downloadSongOffline(song, quality);
          } catch (e) {
            console.error('写入离线库失败', e);
          }
          showToast('已开始下载并加入离线库', 'success');
        }
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : typeof err === 'string' ? err : '下载失败，请稍后再试';
        showToast(message, 'error');
      } finally {
        setDownloadQuality(null);
        setLocalProgress(null);
      }
    },
    [downloadQuality, showToast],
  );

  return {
    downloadQuality,
    downloadProgress,
    isDownloading: downloadQuality !== null,
    handleDownload,
  };
}
