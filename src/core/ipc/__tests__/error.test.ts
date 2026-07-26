import { describe, expect, it } from 'vitest';
import { IpcError, toIpcError } from '../error';

describe('toIpcError', () => {
  it('preserves structured { code, message } objects from the Rust side', () => {
    const error = toIpcError({ code: 'BUSY', message: '推荐服务正在初始化，请稍候' });

    expect(error).toBeInstanceOf(IpcError);
    expect(error.code).toBe('BUSY');
    expect(error.message).toBe('推荐服务正在初始化，请稍候');
  });

  it('falls back to INTERNAL for unknown codes but keeps the message', () => {
    const error = toIpcError({ code: 'NOT_A_REAL_CODE', message: '出错了' });

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('出错了');
  });

  it('wraps bare strings as INTERNAL', () => {
    const error = toIpcError('下载网络文件失败');

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('下载网络文件失败');
  });

  it('wraps Error instances as INTERNAL', () => {
    const error = toIpcError(new TypeError('boom'));

    expect(error.code).toBe('INTERNAL');
    expect(error.message).toBe('boom');
  });

  it('returns IpcError instances unchanged', () => {
    const original = new IpcError('CANCELLED', '推荐任务已被取代');

    expect(toIpcError(original)).toBe(original);
  });

  it('normalizes null / undefined / numbers into INTERNAL errors', () => {
    expect(toIpcError(null).code).toBe('INTERNAL');
    expect(toIpcError(undefined).code).toBe('INTERNAL');
    expect(toIpcError(42).code).toBe('INTERNAL');
    expect(toIpcError(42).message).toContain('42');
  });

  it('uses a placeholder message for structured objects without message', () => {
    const error = toIpcError({ code: 'NETWORK' });

    expect(error.code).toBe('NETWORK');
    expect(error.message).toBe('未知错误');
  });
});
