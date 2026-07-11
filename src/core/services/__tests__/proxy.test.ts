import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocalServerPort } from '../config';
import { getProxies, isLocalServerProxy, proxyFetch } from '../proxy';

describe('proxy configuration', () => {
  afterEach(() => {
    setLocalServerPort(3002);
    vi.unstubAllGlobals();
  });

  it('recognizes stored loopback proxy URLs from an older dynamic port', () => {
    expect(isLocalServerProxy('http://127.0.0.1:3002/api/cors-proxy?url=')).toBe(true);
    expect(isLocalServerProxy('https://example.com/api/cors-proxy?url=')).toBe(false);
  });

  it('replaces a stale stored local proxy with the current dynamic endpoint', () => {
    setLocalServerPort(43123);
    vi.stubGlobal('window', {});
    vi.stubGlobal('localStorage', {
      getItem: () => 'http://127.0.0.1:3002/api/cors-proxy?url=',
    });

    expect(getProxies()).toEqual([
      'http://127.0.0.1:43123/api/cors-proxy?url=',
    ]);
  });

  it('stops proxy retries when the caller cancels the request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('aborted', 'AbortError'));
      });
    }));
    vi.stubGlobal('fetch', fetchMock);

    const request = proxyFetch('https://example.com/data', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
