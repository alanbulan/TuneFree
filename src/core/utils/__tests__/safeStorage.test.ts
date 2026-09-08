import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backupCorruptStorage, safeGetItem, safeGetJson, safeRemoveItem, safeSetItem, safeSetJson } from '../safeStorage';
import { formatBytes, formatUptime } from '../formatting';
import { readCachedDownloadDir, writeCachedDownloadDir } from '../../../desktop/utils/downloadDirCache';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('安全存储', () => {
  it('文本与 JSON 往返，校验失败和损坏输入可备份，不覆盖原值', () => {
    expect(safeGetItem('missing', 'fallback')).toBe('fallback');
    expect(safeSetItem('text', 'hello')).toBe(true); expect(safeGetItem('text')).toBe('hello');
    expect(safeSetJson('json', { value: 2 })).toBe(true); expect(safeGetJson('json', {})).toEqual({ value: 2 });
    expect(safeGetJson('json', 0, (value) => typeof value === 'object' ? 2 : null)).toBe(2);
    expect(safeGetJson('json', 'fallback', () => null)).toBe('fallback');
    expect(safeGetJson('missing', [])).toEqual([]);
    safeSetItem('broken', '{'); vi.spyOn(Date, 'now').mockReturnValue(123);
    expect(safeGetJson('broken', null, undefined, { backupCorrupt: true })).toBeNull();
    expect(safeGetItem('broken_corrupt_123')).toBe('{'); expect(safeGetItem('broken')).toBe('{');
    expect(safeRemoveItem('text')).toBe(true); expect(safeGetItem('text')).toBeNull();
    backupCorruptStorage('manual', 'bad'); expect(safeGetItem('manual_corrupt_123')).toBe('bad');
  });

  it('明确的存储读写失败和循环 JSON 返回失败，不产生未处理异常', () => {
    const error = () => { throw new Error('storage unavailable'); };
    const storage = { getItem: error, setItem: error, removeItem: error };
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(safeGetItem('key', 'fallback', storage)).toBe('fallback');
    expect(safeSetItem('key', 'value', storage)).toBe(false); expect(safeRemoveItem('key', storage)).toBe(false);
    backupCorruptStorage('key', 'bad', storage);
    const circular: { self?: unknown } = {}; circular.self = circular;
    expect(safeSetJson('key', circular, storage)).toBe(false); expect(warning).toHaveBeenCalledTimes(3);
    vi.stubGlobal('localStorage', storage);
    expect(readCachedDownloadDir()).toBeNull(); expect(() => writeCachedDownloadDir('C:/Music')).not.toThrow();
  });

  it('不存在浏览器或被浏览器拒绝访问存储时，返回调用方指定的初始值', () => {
    vi.stubGlobal('window', undefined);
    expect(safeGetItem('key')).toBeNull(); expect(safeSetItem('key', 'value')).toBe(false);
    expect(safeRemoveItem('key')).toBe(false); expect(() => backupCorruptStorage('key', 'bad')).not.toThrow();
    vi.unstubAllGlobals();
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    expect(safeGetItem('key', 'initial')).toBe('initial');
  });
});

describe('状态数值格式', () => {
  it('持续时间显示完整天时分，字节按支持的单位显示', () => {
    expect(formatUptime(0)).toBe('刚启动'); expect(formatUptime(90060)).toBe('1天 1小时 1分');
    expect(formatBytes(0)).toBe('0 B'); expect(formatBytes(1024)).toBe('1 KB'); expect(formatBytes(1536)).toBe('1.5 KB');
  });
});
