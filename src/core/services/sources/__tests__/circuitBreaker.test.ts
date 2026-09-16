import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOpenCircuits,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetCircuits,
  subscribeCircuitBreaker,
} from '../circuitBreaker';

const fail = (times: number) => {
  for (let index = 0; index < times; index += 1) {
    recordFailure('gdstudio', 'netease', 'url', new Error('上游 400'));
  }
};

afterEach(() => {
  resetCircuits();
  vi.useRealTimers();
});

describe('音源熔断器', () => {
  it('未达阈值时照常放行', () => {
    fail(2);
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);
  });

  it('连续失败到阈值后打开熔断', () => {
    fail(3);
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);
    expect(getOpenCircuits()).toMatchObject([
      { providerId: 'gdstudio', platform: 'netease', capability: 'url', failures: 3 },
    ]);
  });

  it('三个维度互相独立：一个平台挂了不影响其他平台或能力', () => {
    fail(3);
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);
    // 同 provider 的其他平台仍然可用（酷我 url 返空不影响它的歌词通道）
    expect(isCircuitOpen('gdstudio', 'kuwo', 'url')).toBe(false);
    // 同平台的其他能力仍然可用
    expect(isCircuitOpen('gdstudio', 'netease', 'lyrics')).toBe(false);
    // 其他 provider 不受牵连
    expect(isCircuitOpen('native', 'netease', 'url')).toBe(false);
  });

  it('一次成功就清掉该通道的失败计数', () => {
    fail(2);
    recordSuccess('gdstudio', 'netease', 'url');
    fail(2);
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);
    expect(getOpenCircuits()).toEqual([]);
  });

  it('冷却期内一直跳过，冷却期满放行一次探测', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    fail(3);
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);

    // 未到冷却期
    vi.setSystemTime(new Date('2030-01-01T00:04:00Z'));
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);

    // 冷却期满：放行一次
    vi.setSystemTime(new Date('2030-01-01T00:05:01Z'));
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);
    // 探测请求还没回结果，不能放第二个进去
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);
  });

  it('探测失败则重新开始冷却，探测成功则彻底恢复', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
    fail(3);
    vi.setSystemTime(new Date('2030-01-01T00:05:01Z'));
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);

    recordFailure('gdstudio', 'netease', 'url', new Error('还是不行'));
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);
    vi.setSystemTime(new Date('2030-01-01T00:09:00Z'));
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(true);

    vi.setSystemTime(new Date('2030-01-01T00:10:02Z'));
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);
    recordSuccess('gdstudio', 'netease', 'url');
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);
    expect(getOpenCircuits()).toEqual([]);
  });

  it('重新加载音源会清空全部熔断', () => {
    fail(3);
    expect(getOpenCircuits()).toHaveLength(1);
    resetCircuits();
    expect(getOpenCircuits()).toEqual([]);
    expect(isCircuitOpen('gdstudio', 'netease', 'url')).toBe(false);
  });

  it('状态变化通知订阅者，快照按代缓存', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeCircuitBreaker(listener);
    const first = getOpenCircuits();

    fail(3);
    expect(listener).toHaveBeenCalledTimes(3);
    const second = getOpenCircuits();
    expect(second).not.toBe(first);
    expect(second).toHaveLength(1);
    // 没有变化时返回同一个引用，useSyncExternalStore 才不会反复重渲染
    expect(getOpenCircuits()).toBe(second);

    unsubscribe();
    fail(1);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('跟踪数量有上限，不会无限增长', () => {
    for (let index = 0; index < 400; index += 1) {
      recordFailure('p', `platform-${index}`, 'url', new Error('x'));
    }
    // 只保留最近的一批，且最早的那条已被淘汰
    expect(isCircuitOpen('p', 'platform-0', 'url')).toBe(false);
    expect(getOpenCircuits().length).toBeLessThanOrEqual(300);
  });
});
