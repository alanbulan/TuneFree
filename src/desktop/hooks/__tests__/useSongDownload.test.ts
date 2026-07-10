import { describe, expect, it } from 'vitest';
import { canContinueDownloadTask, isDownloadProgressForTask } from '../useSongDownload';

describe('isDownloadProgressForTask', () => {
  it('accepts progress only for the active task', () => {
    expect(isDownloadProgressForTask({ taskId: 'download:1', progress: 50 }, 'download:1')).toBe(true);
    expect(isDownloadProgressForTask({ taskId: 'download:2', progress: 80 }, 'download:1')).toBe(false);
    expect(isDownloadProgressForTask({ taskId: 'download:1', progress: 50 }, null)).toBe(false);
  });
});

describe('canContinueDownloadTask', () => {
  it('continues only while the same task is active and not cancelled', () => {
    expect(canContinueDownloadTask('download:1', 'download:1', false)).toBe(true);
    expect(canContinueDownloadTask('download:1', 'download:2', false)).toBe(false);
    expect(canContinueDownloadTask('download:1', 'download:1', true)).toBe(false);
  });
});
