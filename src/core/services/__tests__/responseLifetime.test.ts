import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithTimeout } from '../gdStudioClient';
import { proxyFetch } from '../proxy';
import { bindResponseLifetime } from '../responseLifetime';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('正文读取的取消与超时', () => {
  for (const kind of ['direct', 'proxy'] as const) {
    const request = (signal: AbortSignal) => kind === 'direct'
      ? fetchWithTimeout('https://example.com', { signal }, 100)
      : proxyFetch('https://example.com', { signal }, 100);

    it(`${kind}: 响应头返回后仍响应调用方取消`, async () => {
      const cancel = vi.fn();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
      const controller = new AbortController();
      const response = await request(controller.signal);
      const body = response!.text();
      const rejected = expect(body).rejects.toMatchObject({ name: 'AbortError' });
      controller.abort();
      await rejected;
      expect(cancel).toHaveBeenCalledTimes(1);
    });

    it(`${kind}: 慢正文触发超时并清理监听器`, async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream())));
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const response = await request(controller.signal);
      const rejected = expect(response!.arrayBuffer()).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(101);
      await rejected;
      expect(remove).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });

    it(`${kind}: 正文完成即释放计时器`, async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('完成')));
      const response = await request(new AbortController().signal);
      expect(await response!.text()).toBe('完成');
      expect(vi.getTimerCount()).toBe(0);
    });
  }
});

describe('正文资源释放', () => {
  it('无正文立即释放，流失败也释放读取锁和清理函数', async () => {
    const cleanup = vi.fn(); const controller = new AbortController();
    const empty = new Response(null, { status: 204 }); expect(bindResponseLifetime(empty, { signal: controller.signal, cleanup })).toBe(empty); expect(cleanup).toHaveBeenCalledTimes(1);
    const response = new Response(new ReadableStream({ pull(stream) { stream.error(new Error('正文损坏')); } }));
    await expect(bindResponseLifetime(response, { signal: controller.signal, cleanup }).text()).rejects.toThrow('正文损坏'); expect(cleanup).toHaveBeenCalledTimes(2); expect(response.body?.locked).toBe(false);
  });
  it('调用方直接取消与初始取消信号都传给原始流', async () => {
    const cancel = vi.fn(), cleanup = vi.fn(); const controller = new AbortController();
    const original = new Response(new ReadableStream({ cancel })); const wrapped = bindResponseLifetime(original, { signal: controller.signal, cleanup });
    await wrapped.body!.cancel('不再需要'); expect(cancel).toHaveBeenCalledWith('不再需要'); expect(cleanup).toHaveBeenCalledTimes(1); expect(original.body?.locked).toBe(false);
    controller.abort(new Error('预先取消')); const late = bindResponseLifetime(new Response(new ReadableStream({ cancel })), { signal: controller.signal, cleanup });
    await expect(late.text()).rejects.toThrow('预先取消'); expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
