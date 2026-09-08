import { describe, expect, it, vi } from 'vitest';
import { firstSuccessfulWithConcurrency } from '../resolverMatch';
import { deferred } from '../../__tests__/deferred';

describe('候选并发调度', () => {
  it('失败任务释放名额，全部失败返回空而非悬挂', async () => {
    const worker = vi.fn().mockRejectedValue(new Error('不可用'));
    expect(await firstSuccessfulWithConcurrency([1, 2, 3], 1, 1000, worker)).toBeNull(); expect(worker.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
  });
  it('用户取消终止所有工作，晚到的拒绝不会改变已完成结果', async () => {
    const slow = deferred<string | null>(); const controller = new AbortController();
    const run = firstSuccessfulWithConcurrency([1], 1, 1000, () => slow.promise, controller.signal);
    const rejected = expect(run).rejects.toThrow('用户取消'); controller.abort(new Error('用户取消')); await rejected;
    slow.reject(new Error('晚到失败')); await Promise.resolve(); await Promise.resolve();
    const late = deferred<string | null>(); const success = await firstSuccessfulWithConcurrency([1, 2], 2, 1000, (n) => n === 1 ? Promise.resolve('成功') : late.promise);
    late.reject(new Error('失败')); await Promise.resolve(); await Promise.resolve(); expect(success).toBe('成功');
  });
});
