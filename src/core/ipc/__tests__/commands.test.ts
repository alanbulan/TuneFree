import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

import { invoke } from '@tauri-apps/api/core';
import { invokeCommand } from '../commands';
import { IpcError } from '../error';

describe('invokeCommand', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('forwards the command name and args to invoke', async () => {
    vi.mocked(invoke).mockResolvedValue(true);

    await expect(invokeCommand('cancel_download', { taskId: 'download:1' }))
      .resolves.toBe(true);
    expect(invoke).toHaveBeenCalledWith('cancel_download', { taskId: 'download:1' });
  });

  it('passes undefined args for zero-argument commands', async () => {
    vi.mocked(invoke).mockResolvedValue({ port: 43123, token: 'tok' });

    await expect(invokeCommand('get_local_server_info')).resolves.toEqual({
      port: 43123,
      token: 'tok',
    });
    expect(invoke).toHaveBeenCalledWith('get_local_server_info', undefined);
  });

  it('normalizes structured rejections into IpcError with the original code', async () => {
    vi.mocked(invoke).mockRejectedValue({
      code: 'DOWNLOAD_FAILED',
      message: '下载网络文件失败',
    });

    const error = await invokeCommand('get_download_dir').catch((e) => e);
    expect(error).toBeInstanceOf(IpcError);
    expect(error.code).toBe('DOWNLOAD_FAILED');
    expect(error.message).toBe('下载网络文件失败');
  });

  it('normalizes legacy string rejections into INTERNAL IpcError', async () => {
    vi.mocked(invoke).mockRejectedValue('找不到桌面歌词窗口');

    const error = await invokeCommand('hide_desktop_lyric_window').catch((e) => e);
    expect(error).toBeInstanceOf(IpcError);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('找不到桌面歌词窗口');
  });
});
