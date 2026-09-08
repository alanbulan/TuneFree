import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  invokeCommand,
  isTauri,
  listenEvent,
  toIpcError,
  type DownloadProgressPayload,
  type IpcError,
  type UnlistenFn,
} from '../../core/ipc';
import { getSongUrl, triggerDownload } from '../../core/services/api';
import { notifyOfflineChanged } from '../../core/services/offlineDownloads';
import { stripRuntimeSongFields } from '../../core/services/songStorage';
import { logRecommendationEvent } from '../../core/services/recommendation';
import type { AudioQuality, Song } from '../../core/types';
import { useToast } from '../components/ToastHost';
import { writeCachedDownloadDir } from '../utils/downloadDirCache';
import { DownloadContext, type UseSongDownloadResult } from './downloadContextValue';

export { useSongDownload } from './downloadContextValue';

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

/** How a failed download should be surfaced to the user. */
export interface DownloadFailurePresentation {
  /** 用户主动取消属于正常路径，不弹提示。 */
  silent: boolean;
  message: string;
  /** 是否在提示上附带「选择目录」操作。 */
  offerDirectoryPicker: boolean;
}

/**
 * Routes a download failure by `IpcError.code` instead of by message text.
 * Cancellation is recognised from the error itself, so no local flag is
 * consulted when classifying.
 */
export const describeDownloadFailure = (error: IpcError): DownloadFailurePresentation => {
  switch (error.code) {
    case 'CANCELLED':
      return { silent: true, message: error.message, offerDirectoryPicker: false };
    case 'DOWNLOAD_DIR_UNAUTHORIZED':
    case 'DOWNLOAD_DIR_INVALID':
      return {
        silent: false,
        message: `${error.message || '下载目录不可用'}，请重新选择下载目录`,
        offerDirectoryPicker: true,
      };
    case 'NETWORK':
    case 'TIMEOUT':
      return {
        silent: false,
        message: `${error.message || '网络异常'}，请检查网络后重试`,
        offerDirectoryPicker: false,
      };
    default:
      return {
        silent: false,
        message: error.message || '下载失败，请稍后再试',
        offerDirectoryPicker: false,
      };
  }
};

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
    if (!isTauri()) return;

    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    void listenEvent('download-progress', (payload) => {
      if (cancelled || !isDownloadProgressForTask(payload, activeTaskIdRef.current)) return;
      setDownloadProgress(payload.progress);
    }).then((unlistenFn) => {
      if (cancelled) unlistenFn();
      else unlisten = unlistenFn;
    }).catch((error: unknown) => console.warn('订阅下载进度失败', error));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const reselectDownloadDir = useCallback(async () => {
    try {
      const directory = await invokeCommand('select_download_dir');
      if (!directory) return;
      writeCachedDownloadDir(directory);
      showToast('下载目录已更新，请重新下载', 'success');
    } catch (error: unknown) {
      showToast(toIpcError(error).message, 'error');
    }
  }, [showToast]);

  const reportDownloadFailure = useCallback(
    (error: unknown) => {
      const presentation = describeDownloadFailure(toIpcError(error));
      if (presentation.silent) return;
      showToast(
        presentation.message,
        'error',
        presentation.offerDirectoryPicker
          ? { label: '选择目录', onClick: () => void reselectDownloadDir() }
          : undefined,
      );
    },
    [reselectDownloadDir, showToast],
  );

  const cancelDownload = useCallback(async () => {
    const taskId = activeTaskIdRef.current;
    if (!taskId || cancellationRequestedRef.current) return;

    cancellationRequestedRef.current = true;
    setIsCancelling(true);

    if (!isTauri()) return;

    try {
      await invokeCommand('cancel_download', { taskId });
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

        if (!isTauri()) {
          triggerDownload(url, filename);
          showToast('已开始下载', 'success');
          return;
        }

        // 下载目录由后端唯一持有，前端不再传路径。
        await invokeCommand('download_song_to_local', {
          url,
          filename,
          taskId,
          metadata: { song: { ...stripRuntimeSongFields(song), lrc: song.lrc, lyricBundle: song.lyricBundle }, quality },
        });
        notifyOfflineChanged();
        void logRecommendationEvent({ eventType: 'download', song, quality, context: 'download' }).catch(() => {});
        showToast('下载成功，已保存至本地下载目录', 'success');
      } catch (err: unknown) {
        reportDownloadFailure(err);
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
    [reportDownloadFailure, showToast],
  );

  const value = useMemo<UseSongDownloadResult>(() => ({
    downloadQuality,
    downloadProgress,
    isDownloading: downloadQuality !== null,
    isCancelling,
    handleDownload,
    cancelDownload,
  }), [cancelDownload, downloadProgress, downloadQuality, handleDownload, isCancelling]);

  return <DownloadContext.Provider value={value}>{children}</DownloadContext.Provider>;
}
