import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gdStudioClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gdStudioClient')>();
  return { ...actual, fetchGDStudioData: vi.fn() };
});

vi.mock('../proxy', async (original) => ({ ...await original<typeof import('../proxy')>(), proxyFetch: vi.fn() }));

import {
  getGDStudioLyrics,
  getGDStudioSongUrl,
  parseGDStudioSongFull,
  resolveAutosource,
  searchGDStudio,
  getGDStudioPic, resolveGDStudioPic, getAIRecommendedSongs, isGDStudioSource,
} from '../gdStudio';
import { proxyFetch } from '../proxy';
import { fetchGDStudioData, GDStudioApiError } from '../gdStudioClient';
import { lyricCache, trackMetaCache, urlCache, picCache, rememberTrackMeta, resolveTrackMeta } from '../gdStudioModel';

const mockedFetchData = vi.mocked(fetchGDStudioData);

const validTrack = {
  id: '003',
  name: '江南',
  artist: ['林俊杰'],
  album: '第二天堂',
  pic_id: 'pic',
  url_id: 'url',
  lyric_id: 'lyric',
  source: 'joox',
};

describe('GD 数据边界与封面补全', () => {
  beforeEach(() => { vi.resetAllMocks(); lyricCache.clear(); trackMetaCache.clear(); urlCache.clear(); picCache.clear(); });
  afterEach(() => vi.restoreAllMocks());
  it('拒绝无效搜索结构及错误音源，不将请求失败永久缓存', async () => {
    for (const input of [{}, [null], [{ ...validTrack, artist: 42 }], [{ ...validTrack, source: 'qq' }]]) {
      mockedFetchData.mockResolvedValueOnce(input); await expect(searchGDStudio('词', 'joox', 1, 5)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    }
    expect(isGDStudioSource('qq')).toBe(true); expect(isGDStudioSource('unknown')).toBe(false);
    mockedFetchData.mockRejectedValueOnce(new Error('offline')); expect(await getGDStudioSongUrl('failed', 'joox', 'flac24bit')).toBeNull();
    mockedFetchData.mockResolvedValueOnce({ lyric: '[00:01]hello', tlyric: ' [00:01]你好 ' });
    const lyric = await getGDStudioLyrics('translated', 'joox'); expect(lyric).toContain('你好');
    const count = mockedFetchData.mock.calls.length; expect(await getGDStudioLyrics('translated', 'joox')).toBe(lyric); expect(mockedFetchData).toHaveBeenCalledTimes(count);
  });
  it('直链、原生网易详情、QQ、Joox 与接口封面按正确路径加载并缓存', async () => {
    expect(await getGDStudioPic('qq', '')).toBe('');
    expect(await getGDStudioPic('qq', '//example.test/a.jpg')).toBe('https://example.test/a.jpg');
    expect(await getGDStudioPic('qq', '//example.test/a.jpg')).toBe('https://example.test/a.jpg');
    expect(await getGDStudioPic('qq', 'album')).toContain('album.jpg'); expect(await getGDStudioPic('joox', 'pic')).toContain('pic');
    vi.mocked(proxyFetch).mockResolvedValueOnce(new Response(JSON.stringify({ songs: [{ album: { picUrl: '//example.test/native.jpg' } }] })));
    expect(await getGDStudioPic('netease', 'pic', 500, 'song')).toBe('https://example.test/native.jpg');
    expect(proxyFetch).toHaveBeenCalledWith(expect.stringContaining('id=song'), expect.anything(), 8000);
    vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.mocked(proxyFetch).mockRejectedValueOnce(new Error('detail'));
    mockedFetchData.mockResolvedValueOnce({ url: '//example.test/fallback.jpg' });
    expect(await getGDStudioPic('netease', 'failed')).toBe('https://example.test/fallback.jpg'); expect(console.warn).toHaveBeenCalled();
    mockedFetchData.mockResolvedValueOnce({}); expect(await getGDStudioPic('kuwo', 'empty')).toBe('');
    mockedFetchData.mockRejectedValueOnce(new Error('pic')); expect(await getGDStudioPic('kuwo', 'failed')).toBe('');
    expect(await resolveGDStudioPic('1', 'qq', { pic: '//example.test/cached.jpg' })).toBe('https://example.test/cached.jpg');
    expect(await resolveGDStudioPic('2', 'qq')).toBe('');
    expect(await resolveGDStudioPic('3', 'qq', { picId: 'album' })).toContain('album.jpg'); expect(resolveTrackMeta('3', 'qq').picId).toBe('album');
  });
  it('自动选源校验来源、合并翻译，AI 推荐完成封面补全和标准化', async () => {
    const song = { name: '江南', artist: '林俊杰', album: '第二天堂', source: 'embeat' };
    for (const response of [null, [], { url: 'https://example.test/song.mp3', source: 'unknown' }]) {
      mockedFetchData.mockResolvedValueOnce(response); await expect(resolveAutosource(song)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    }
    mockedFetchData.mockResolvedValueOnce({ url: 'https://example.test/song.mp3', lyric: '[00:01]你好', tlyric: '[00:01]hello' });
    expect((await resolveAutosource(song)).lrc).toContain('hello');
    mockedFetchData.mockResolvedValueOnce([{ ...validTrack, source: 'qq', artist: '林俊杰' }]);
    expect(await getAIRecommendedSongs('雨夜')).toEqual([expect.objectContaining({ id: '003', name: '江南', pic: expect.stringContaining('pic.jpg') })]);
  });
});

describe('GD Studio service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lyricCache.clear();
    trackMetaCache.clear();
    urlCache.clear();
    picCache.clear();
  });

  it('validates search fields and deduplicates source:id', async () => {
    mockedFetchData.mockResolvedValue([validTrack, { ...validTrack, name: '重复项' }]);
    const songs = await searchGDStudio('林俊杰', 'joox', 1, 20);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id: '003', source: 'joox', name: '江南' });
  });

  it('rejects search results without a stable identity', async () => {
    mockedFetchData.mockResolvedValue([{ ...validTrack, id: '' }]);
    await expect(searchGDStudio('林俊杰', 'joox', 1, 20))
      .rejects.toThrow(GDStudioApiError);
  });

  it('passes bitrate to autosource and rejects an empty URL', async () => {
    mockedFetchData.mockResolvedValue({ url: '', source: '', id: '' });
    await expect(resolveAutosource({
      name: '江南', artist: '林俊杰', album: '第二天堂', source: 'embeat',
    }, 'flac')).rejects.toThrow(/autosource response is missing url/);
    expect(mockedFetchData).toHaveBeenCalledWith(expect.objectContaining({
      types: 'autosource', source: 'embeat', br: '740',
    }), undefined);
  });

  it('returns the upstream autosource id as the resolved audio and lyric identity', async () => {
    mockedFetchData.mockResolvedValue({
      url: 'https://example.com/song.mp3',
      lyric: '[00:00.00]江南',
      source: 'netease',
      id: 'netease-123',
    });

    await expect(resolveAutosource({
      name: '江南', artist: '林俊杰', album: '第二天堂', source: 'embeat',
    })).resolves.toMatchObject({
      resolvedSource: 'netease',
      resolvedId: 'netease-123',
      resolvedLyricId: 'netease-123',
    });
  });

  it('does not invent a resolved identity when autosource omits a usable id', async () => {
    mockedFetchData.mockResolvedValue({
      url: 'https://example.com/song.mp3',
      source: 'netease',
      id: '   ',
    });

    await expect(resolveAutosource({
      name: '江南', artist: '林俊杰', album: '第二天堂', source: 'embeat',
    })).resolves.toEqual({
      url: 'https://example.com/song.mp3',
      lrc: '',
      pic: '',
      resolvedSource: 'netease',
      resolvedId: undefined,
      resolvedLyricId: undefined,
    });
  });

  it('does not permanently cache an empty lyric after a failed request', async () => {
    mockedFetchData
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({ lyric: '[00:00.00]江南', tlyric: '' });

    expect(await getGDStudioLyrics('1', 'joox')).toBe('');
    expect(await getGDStudioLyrics('1', 'joox')).toContain('江南');
    expect(mockedFetchData).toHaveBeenCalledTimes(2);
  });

  it('deferred metadata only fetches audio and restores the persisted URL identity', async () => {
    mockedFetchData.mockResolvedValue({ url: 'https://example.com/audio.mp3' });
    const result = await parseGDStudioSongFull('song-id', 'kuwo', '320k', {
      urlId: 'real-url-id', lyricId: 'real-lyric-id', picId: 'cover-id',
    }, { deferMetadata: true });
    expect(result).toEqual({ url: 'https://example.com/audio.mp3', lrc: '', pic: '' });
    expect(mockedFetchData).toHaveBeenCalledTimes(1);
    expect(mockedFetchData).toHaveBeenCalledWith(expect.objectContaining({ types: 'url', id: 'real-url-id' }), undefined);
  });

  it('forceRefresh bypasses the underlying URL cache', async () => {
    mockedFetchData.mockResolvedValueOnce({ url: 'https://example.com/expired.mp3' })
      .mockResolvedValueOnce({ url: 'https://example.com/fresh.mp3' });
    expect(await getGDStudioSongUrl('1', 'joox')).toContain('expired');
    expect(await getGDStudioSongUrl('1', 'joox')).toContain('expired');
    expect(mockedFetchData).toHaveBeenCalledTimes(1);
    expect(await getGDStudioSongUrl('1', 'joox', '320k', { forceRefresh: true })).toContain('fresh');
    expect(mockedFetchData).toHaveBeenCalledTimes(2);
  });

  it('metadata cache excludes audio and lyrics and retains previously known identities', () => {
    rememberTrackMeta('1', 'qq', { urlId: 'real-url-id', lyricId: 'lyric' });
    const song = { picId: 'pic', urlId: undefined, url: 'temporary', lrc: 'long lyrics' };
    rememberTrackMeta('1', 'qq', song);
    expect(resolveTrackMeta('1', 'qq')).toEqual({ urlId: 'real-url-id', lyricId: 'lyric', picId: 'pic' });
  });
});
