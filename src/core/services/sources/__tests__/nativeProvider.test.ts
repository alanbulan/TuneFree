import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { NATIVE_PLATFORMS, nativeProvider } from '../nativeProvider';

describe('nativeProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://cdn.test/a.mp3' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('只认内置解析支持的平台', () => {
    expect(NATIVE_PLATFORMS).toEqual(['netease', 'qq', 'kuwo']);
    expect(nativeProvider.platforms).toEqual(['netease', 'qq', 'kuwo']);
  });

  it('不支持的平台直接返回 null，不发起请求', async () => {
    await expect(nativeProvider.getUrl!({ platform: 'kugou', id: 1, quality: '320k' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('支持平台返回规范化后的地址', async () => {
    await expect(nativeProvider.getUrl!({ platform: 'qq', id: 'mid-1', quality: '320k' })).resolves.toBe(
      'https://cdn.test/a.mp3',
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('platform=qq');
  });

  it('搜索与榜单：只认自己声明的平台', async () => {
    await expect(nativeProvider.search!('词', 'kugou', 1, 5)).resolves.toEqual([]);
    await expect(nativeProvider.topLists!('kugou')).resolves.toEqual([]);
    await expect(nativeProvider.topListDetail!(1, 'kugou')).resolves.toEqual([]);
  });

  it('没有可播放地址时返回 null', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));
    await expect(nativeProvider.getUrl!({ platform: 'netease', id: 1, quality: '320k' })).resolves.toBeNull();

    fetchMock.mockResolvedValue(new Response('{}', { status: 500 }));
    await expect(nativeProvider.getUrl!({ platform: 'netease', id: 1, quality: '320k' })).resolves.toBeNull();
  });
});
