import { createContext, useContext } from 'react';
import type { AudioQuality, Song } from '../../core/types';

export interface UseSongDownloadResult {
  downloadQuality: AudioQuality | null;
  downloadProgress: number | null;
  isDownloading: boolean;
  isCancelling: boolean;
  handleDownload: (song: Song, quality: AudioQuality) => Promise<void>;
  cancelDownload: () => Promise<void>;
}

// 不依赖下载服务，服务热更新时 Provider 与消费者保持同一 Context。
export const DownloadContext = createContext<UseSongDownloadResult | null>(null);

export function useSongDownload(): UseSongDownloadResult {
  const context = useContext(DownloadContext);
  if (!context) throw new Error('useSongDownload 必须在 DownloadProvider 内使用');
  return context;
}
