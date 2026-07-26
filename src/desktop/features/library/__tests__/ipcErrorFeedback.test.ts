import { describe, expect, it, vi } from 'vitest';
import { IpcError } from '../../../../core/ipc';
import {
  busyRetryDelayMs,
  describeIpcFailure,
  isBusyIpcError,
  maxBusyRetries,
  retryWhileBusy,
} from '../ipcErrorFeedback';

describe('describeIpcFailure', () => {
  it('静默处理用户主动取消', () => {
    const result = describeIpcFailure(new IpcError('CANCELLED', '已取消'), '兜底');
    expect(result.message).toBeNull();
  });

  it('下载目录失效时要求重新选择目录', () => {
    for (const code of ['DOWNLOAD_DIR_UNAUTHORIZED', 'DOWNLOAD_DIR_INVALID'] as const) {
      const result = describeIpcFailure(new IpcError(code, '下载目录不可用'), '兜底');
      expect(result.needsDirectoryReselect).toBe(true);
      expect(result.tone).toBe('error');
      expect(result.message).toContain('下载目录不可用');
    }
  });

  it('网络与超时标记为可重试', () => {
    for (const code of ['NETWORK', 'TIMEOUT'] as const) {
      const result = describeIpcFailure(new IpcError(code, '请求失败'), '兜底');
      expect(result.retryable).toBe(true);
      expect(result.tone).toBe('warning');
    }
  });

  it('凭据不可用提示平台限制', () => {
    const result = describeIpcFailure(new IpcError('CREDENTIAL_UNAVAILABLE', '当前平台不可用'), '兜底');
    expect(result.tone).toBe('warning');
    expect(result.message).toContain('当前平台');
  });

  it('BUSY 标记为初始化中且语气为 info', () => {
    const result = describeIpcFailure(new IpcError('BUSY', '推荐服务正在初始化'), '兜底');
    expect(result.busy).toBe(true);
    expect(result.tone).toBe('info');
    expect(result.message).toBe('推荐服务正在初始化');
  });

  it('裸字符串与未知值回落到兜底文案', () => {
    expect(describeIpcFailure('后端炸了', '兜底').message).toBe('后端炸了');
    expect(describeIpcFailure(new IpcError('INTERNAL', ''), '兜底').message).toBe('兜底');
  });
});

describe('retryWhileBusy', () => {
  const busy = () => new IpcError('BUSY', '推荐服务正在初始化');

  it('BUSY 时退避重试直到成功', async () => {
    const wait = vi.fn(() => Promise.resolve());
    const onBusy = vi.fn();
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(busy())
      .mockRejectedValueOnce(busy())
      .mockResolvedValueOnce('ok');

    await expect(retryWhileBusy(run, onBusy, wait)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(3);
    expect(onBusy).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(busyRetryDelayMs);
  });

  it('超过重试上限后抛出原始错误', async () => {
    const wait = vi.fn(() => Promise.resolve());
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(busy());

    await expect(retryWhileBusy(run, undefined, wait)).rejects.toThrow('推荐服务正在初始化');
    expect(run).toHaveBeenCalledTimes(maxBusyRetries + 1);
  });

  it('非 BUSY 错误立即上抛，不重试', async () => {
    const wait = vi.fn(() => Promise.resolve());
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(new IpcError('NETWORK', '网络错误'));

    await expect(retryWhileBusy(run, undefined, wait)).rejects.toThrow('网络错误');
    expect(run).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('isBusyIpcError 只认结构化 BUSY', () => {
    expect(isBusyIpcError(busy())).toBe(true);
    expect(isBusyIpcError(new IpcError('INTERNAL', 'BUSY'))).toBe(false);
    expect(isBusyIpcError('BUSY')).toBe(false);
  });
});
