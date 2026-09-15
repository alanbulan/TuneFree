import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoundedCache, pruneExpiredEntries } from '../boundedCache';

afterEach(() => vi.useRealTimers());

describe('有界缓存', () => {
  it('保留最近使用的条目，访问不会延长 TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const cache = new BoundedCache<string, number>(2, 100);
    cache.set('a', 1);
    cache.set('b', 2);
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    vi.setSystemTime(99);
    expect(cache.get('a')).toBe(1);
    vi.setSystemTime(100);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it('delete 与 clear 生效', () => {
    const cache = new BoundedCache<string, number>(2, 100);
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.delete('a')).toBe(false);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('迭代器提前结束时清理不会死循环', () => {
    // 防御性分支：容量超限时如果 keys() 直接结束，必须跳出循环
    const entries = new Map([['a', { expiresAt: Number.POSITIVE_INFINITY }]]);
    entries.keys = (() => ({ next: () => ({ done: true, value: undefined }) })) as unknown as () => MapIterator<string>;
    expect(() => pruneExpiredEntries(entries, 0)).not.toThrow();
  });

  it('清理非当前 key 的过期条目，更新同一 key 不挤占额外容量', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10);
    const entries = new Map([
      ['live', { expiresAt: 100 }], ['stale', { expiresAt: 5 }],
    ]);
    pruneExpiredEntries(entries, 2);
    expect([...entries.keys()]).toEqual(['live']);
    const cache = new BoundedCache<string, number>(1, 100);
    cache.set('a', 1);
    cache.set('a', 2);
    expect(cache.size).toBe(1);
    expect(cache.get('a')).toBe(2);
  });
});
