import { describe, expect, it } from 'vitest';
import { IpcError } from '../../../core/ipc';
import {
  canContinueDownloadTask,
  describeDownloadFailure,
  isDownloadProgressForTask,
} from '../useSongDownload';

const progress = (taskId: string, value: number) => ({
  taskId,
  url: 'https://example.com/song.mp3',
  progress: value,
});

describe('isDownloadProgressForTask', () => {
  it('accepts progress only for the active task', () => {
    expect(isDownloadProgressForTask(progress('download:1', 50), 'download:1')).toBe(true);
    expect(isDownloadProgressForTask(progress('download:2', 80), 'download:1')).toBe(false);
    expect(isDownloadProgressForTask(progress('download:1', 50), null)).toBe(false);
  });
});

describe('canContinueDownloadTask', () => {
  it('continues only while the same task is active and not cancelled', () => {
    expect(canContinueDownloadTask('download:1', 'download:1', false)).toBe(true);
    expect(canContinueDownloadTask('download:1', 'download:2', false)).toBe(false);
    expect(canContinueDownloadTask('download:1', 'download:1', true)).toBe(false);
  });
});

describe('describeDownloadFailure', () => {
  it('stays silent when the backend reports cancellation', () => {
    const result = describeDownloadFailure(new IpcError('CANCELLED', '下载已取消'));
    expect(result.silent).toBe(true);
    expect(result.offerDirectoryPicker).toBe(false);
  });

  it('offers the directory picker for download directory failures', () => {
    for (const code of ['DOWNLOAD_DIR_UNAUTHORIZED', 'DOWNLOAD_DIR_INVALID'] as const) {
      const result = describeDownloadFailure(new IpcError(code, '下载目录未授权'));
      expect(result.silent).toBe(false);
      expect(result.offerDirectoryPicker).toBe(true);
      expect(result.message).toContain('下载目录未授权');
    }
  });

  it('asks the user to retry on network and timeout failures', () => {
    for (const code of ['NETWORK', 'TIMEOUT'] as const) {
      const result = describeDownloadFailure(new IpcError(code, '网络请求失败'));
      expect(result.offerDirectoryPicker).toBe(false);
      expect(result.message).toContain('重试');
    }
  });

  it('shows the backend message verbatim for unclassified failures', () => {
    const result = describeDownloadFailure(new IpcError('DOWNLOAD_FAILED', '写入文件失败'));
    expect(result).toEqual({
      silent: false,
      message: '写入文件失败',
      offerDirectoryPicker: false,
    });
  });

  it('falls back to a generic message when the backend sends none', () => {
    const result = describeDownloadFailure(new IpcError('INTERNAL', ''));
    expect(result.message).toBe('下载失败，请稍后再试');
  });
});
