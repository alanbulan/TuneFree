import { afterEach, describe, expect, it } from 'vitest';
import { setLocalServerInfo } from '../config';
import { normalizeMusicUrl, stableMusicUrl } from '../musicUrl';
import { stripRuntimeSongFields } from '../songStorage';

afterEach(() => setLocalServerInfo({ port: 3002, token: '' }));

describe('音乐资源地址', () => {
  it('反复标准化保持幂等，换端口后不留下旧令牌或旧代理', () => {
    const upstream = 'http://img1.kuwo.cn/cover.jpg';
    setLocalServerInfo({ port: 51001, token: 'old' });
    const old = normalizeMusicUrl(upstream);
    expect(normalizeMusicUrl(old)).toBe(old);
    const nested = `http://127.0.0.1:51001/api/cors-proxy?token=old&url=${encodeURIComponent(old)}`;
    setLocalServerInfo({ port: 51002, token: 'new' });
    expect(normalizeMusicUrl(nested)).toBe(normalizeMusicUrl(upstream));
    expect(stableMusicUrl(nested)).toBe(upstream);
  });

  it('只按真实主机名匹配音源，不误代理查询参数或相似域名', () => {
    for (const url of ['http://example.com/?host=kuwo.cn', 'http://kuwo.cn.example.com/a']) {
      expect(normalizeMusicUrl(url)).toBe(url);
    }
    expect(normalizeMusicUrl('http://p.music.126.net/a')).toBe('https://p.music.126.net/a');
  });

  it('保存稳定封面和资源 ID，剔除歌词与临时播放地址', () => {
    const song = stripRuntimeSongFields({ id: 1, source: 'kuwo', name: '歌', artist: '人', album: '',
      urlId: 'track-id', pic: normalizeMusicUrl('http://img1.kuwo.cn/a'), lrc: '大段歌词', url: '临时地址' });
    expect(song).toMatchObject({ urlId: 'track-id', pic: 'http://img1.kuwo.cn/a' });
    expect(song).not.toHaveProperty('url');
    expect(song).not.toHaveProperty('lrc');
  });

  it('保留 Tauri 文件资源地址，持久化时移除失效的会话端点', () => {
    expect(normalizeMusicUrl('http://asset.localhost/C%3A/music/cover.jpg')).toBe('http://asset.localhost/C%3A/music/cover.jpg');
    expect(normalizeMusicUrl('asset://localhost/cover.jpg')).toBe('asset://localhost/cover.jpg');
    expect(stableMusicUrl('http://127.0.0.1:51001/api/temporary?token=old')).toBe('');
  });
});
