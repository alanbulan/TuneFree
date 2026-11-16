import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recommendationJob } from '../../../core/__tests__/recommendationFixtures';
import type { RecommendationRuntimeState } from '../../../core/services/recommendationRuntime';
import { useCompanionThinking } from '../useCompanionThinking';

const mocks = vi.hoisted(() => ({ state: { job: null, loading: false, initializing: false, error: '' } as RecommendationRuntimeState,
  listeners: new Set<() => void>() }));
vi.mock('../../../core/services/recommendationRuntime', () => ({
  getRecommendationRuntimeState: () => mocks.state,
  subscribeRecommendationRuntime: (listener: () => void) => {
    mocks.listeners.add(listener); return () => mocks.listeners.delete(listener);
  },
}));
afterEach(() => { cleanup(); mocks.state = { job: null, loading: false, initializing: false, error: '' }; });
describe('音乐伙伴共享推荐状态', () => {
  it('只在后台真实运行或意境请求中思考，等待、取消和结束均停止', () => {
    const view = renderHook(({ busy }) => useCompanionThinking(busy), { initialProps: { busy: false } });
    expect(view.result.current).toBe(false);
    for (const status of ['running', 'waiting', 'cancelled', 'done', 'disabled', 'error'] as const) {
      act(() => { mocks.state = { ...mocks.state, job: recommendationJob({ status }) }; mocks.listeners.forEach((listener) => listener()); });
      expect(view.result.current).toBe(status === 'running');
    }
    view.rerender({ busy: true }); expect(view.result.current).toBe(true);
    view.unmount(); expect(mocks.listeners.size).toBe(0);
  });
});
