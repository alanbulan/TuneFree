import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getSongUrl, triggerDownload } from '../../core/services/api';
import { saveDownloadMeta } from '../../core/services/offlineDownloads';
import { logRecommendationEvent } from '../../core/services/recommendation';
import type { AudioQuality, Song } from '../../core/types';
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
  /** Whether cancellation has been requested for the active download. */
  isCancelling: boolean;
  /** Start downloading `song` at the given `quality`. */
  handleDownload: (song: Song, quality: AudioQuality) => Promise<void>;
  /** Cancel the active download or prevent a pending URL resolution from starting one. */
  cancelDownload: () => Promise<void>;
}

interface DownloadedFileResult {
  filepath: string;
  filename: string;
}

interface DownloadProgressPayload {
  taskId: string;
  progress: number;
}

const DownloadContext = createContext<UseSongDownloadResult | null>(null);

const createDownloadTaskId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `download:${crypto.randomUUID()}`;
  }
  return `download:${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const isDownloadProgressForTask = (
  payload: DownloadProgressPayload,
  taskId: string | null,
): boolean => !!taskId && payload.taskId === taskId;

export const canContinueDownloadTask = (
  taskId: string,
  activeTaskId: string | null,
  cancellationRequested: boolean,
): boolean => activeTaskId === taskId && !cancellationRequested;

/**
 * Shared download logic used by both DesktopTransport and DesktopFullPlayer.
 * Encapsulates URL resolution, Tauri / browser download dispatch, and
 * offline-library caching.
 */
export function DownloadProvider({ children }: PropsWithChildren) {
  const { showToast } = useToast();
  const [downloadQuality, setDownloadQuality] = useState<AudioQuality | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const activeTaskIdRef = useRef<string | null>(null);
  const cancellationRequestedRef = useRef(false);

  useEffect(() => {
    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<DownloadProgressPayload>('download-progress', (event) => {
      if (cancelled || !isDownloadProgressForTask(event.payload, activeTaskIdRef.current)) return;
      setDownloadProgress(event.payload.progress);
    }).then((unlistenFn) => {
      if (cancelled) unlistenFn();
      else unlisten = unlistenFn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const cancelDownload = useCallback(async () => {
    const taskId = activeTaskIdRef.current;
    if (!taskId || cancellationRequestedRef.current) return;

    cancellationRequestedRef.current = true;
    setIsCancelling(true);

    const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    if (!isTauri) return;

    try {
      await invoke<boolean>('cancel_download', { taskId });
    } catch (error) {
      console.error('取消下载失败', error);
    }
  }, []);

  const handleDownload = useCallback(
    async (song: Song, quality: AudioQuality) => {
      if (activeTaskIdRef.current) return;

      const taskId = createDownloadTaskId();
      activeTaskIdRef.current = taskId;
      cancellationRequestedRef.current = false;
      setDownloadQuality(quality);
      setDownloadProgress(0);
      setIsCancelling(false);
      try {
        const url = await getSongUrl(song.id, song.source, quality, song);
        if (!canContinueDownloadTask(
          taskId,
          activeTaskIdRef.current,
          cancellationRequestedRef.current,
        )) return;
        if (!url) {
          showToast('无法获取下载地址', 'error');
          return;
        }

        const meta = getDownloadMeta(quality);
        const filename = `${song.artist} - ${song.name}.${meta.ext}`;

        const isTauri =
          typeof window !== 'undefined' &&
          '__TAURI_INTERNALS__' in window;

        if (isTauri) {
          const customDir = localStorage.getItem('tunefree_download_dir') || null;
          const savedFile = await invoke<DownloadedFileResult>('download_song_to_local', {
            url,
            filename,
            customDir,
            taskId,
          });
          try {
            await saveDownloadMeta(savedFile.filename, song, String(quality));
            void logRecommendationEvent({
              eventType: 'download',
              song,
              quality: String(quality),
              context: 'download',
            }).catch(() => {});
          } catch (e) {
            console.error('保存下载元数据失败', e);
          }
          showToast('下载成功，已保存至本地下载目录', 'success');
        } else {
          triggerDownload(url, filename);
          showToast('已开始下载', 'success');
        }
      } catch (err: unknown) {
        if (!cancellationRequestedRef.current) {
          const message =
            err instanceof Error ? err.message : typeof err === 'string' ? err : '下载失败，请稍后再试';
          showToast(message, 'error');
        }
      } finally {
        if (activeTaskIdRef.current === taskId) {
          activeTaskIdRef.current = null;
          cancellationRequestedRef.current = false;
          setDownloadQuality(null);
          setDownloadProgress(null);
          setIsCancelling(false);
        }
      }
    },
    [showToast],
  );

  const value = useMemo<UseSongDownloadResult>(() => ({
    downloadQuality,
    downloadProgress,
    isDownloading: downloadQuality !== null,
    isCancelling,
    handleDownload,
    cancelDownload,
  }), [cancelDownload, downloadProgress, downloadQuality, handleDownload, isCancelling]);

  return createElement(DownloadContext.Provider, { value }, children);
}

export function useSongDownload(): UseSongDownloadResult {
  const context = useContext(DownloadContext);
  if (!context) throw new Error('useSongDownload 必须在 DownloadProvider 内使用');
  return context;
}
