import { afterEach, describe, expect, it } from 'vitest';
import { setLocalServerInfo, SELF_HOSTED_PROXY } from '../config';
import { canAnalyseMediaUrl, normalizeProxyPlayableUrl, PLAYBACK_PROXY_HOSTS } from '../playbackMediaUrl';

afterEach(() => setLocalServerInfo({ port: 3002, token: '' }));

describe('播放媒体的可信代理与签名URL', () => {
  it('签名query保留百分号、加号和参数顺序，整目标只编码一层且幂等', () => {
    setLocalServerInfo({ port: 51001, token: 'session/+&token' });
    const upstream = 'https://stream.qqmusic.qq.com/a%2Fb.mp3?sig=a%2Fb+c&empty=&key=x%26y&key=second';
    const playable = normalizeProxyPlayableUrl(upstream);
    expect(playable).toBe(`${SELF_HOSTED_PROXY}${encodeURIComponent(upstream)}`);
    expect(new URL(playable).searchParams.get('url')).toBe(upstream);
    expect(new URL(playable).searchParams.get('token')).toBe('session/+&token');
    expect(normalizeProxyPlayableUrl(playable)).toBe(playable);
    const nested = `http://127.0.0.1:51001/api/cors-proxy?token=old&url=${encodeURIComponent(playable)}`;
    setLocalServerInfo({ port: 51002, token: 'new-session' });
    expect(normalizeProxyPlayableUrl(nested)).toBe(`${SELF_HOSTED_PROXY}${encodeURIComponent(upstream)}`);
    expect(normalizeProxyPlayableUrl(nested)).not.toContain('old');
  });

  it('仅匹配完整CDN hostname及子域，自定义地址/相似域名/非http媒体保持原样', () => {
    for (const host of PLAYBACK_PROXY_HOSTS) {
      expect(normalizeProxyPlayableUrl(`https://sub.${host}/audio.mp3`)).toContain('/api/cors-proxy?');
    }
    for (const value of ['https://example.com/?host=kuwo.cn', 'https://qqmusic.qq.com.example.com/a',
      'https://notmusic.126.net/a', 'https://qqmusic.qq.com@example.com/a', 'ftp://music.126.net/a',
      'blob:https://example.com/id', 'data:audio/wav;base64,AA==', 'asset://localhost/music.mp3', '/audio.mp3', 'bad']) {
      expect(normalizeProxyPlayableUrl(value)).toBe(value);
    }
    const raw = '//m10.music.126.net/a.mp3';
    expect(new URL(normalizeProxyPlayableUrl(raw)).searchParams.get('url')).toBe(`https:${raw}`);
  });

  it('分析能力允许同源和Tauri媒体，远端无CORS和非法URL不能接WebAudio', () => {
    for (const value of ['/audio.mp3', window.location.href, 'asset://localhost/audio.mp3',
      'http://asset.localhost/C%3A/music.mp3', 'blob:https://example.com/id', 'data:audio/wav;base64,AA==',
      'http://127.0.0.1:51002/api/cors-proxy?token=t&url=x']) {
      expect(canAnalyseMediaUrl(value)).toBe(true);
    }
    for (const value of ['https://cdn.example.com/song.mp3', 'https://music.126.net/song.mp3',
      'http://127.0.0.1:5000/private', 'http://[', 'https://asset.localhost.example.com/a']) {
      expect(canAnalyseMediaUrl(value)).toBe(false);
    }
  });
});
