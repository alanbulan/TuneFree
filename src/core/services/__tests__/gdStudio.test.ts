import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gdStudioClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gdStudioClient')>();
  return { ...actual, fetchGDStudioData: vi.fn() };
});

import {
  getGDStudioLyrics,
  resolveAutosource,
  searchGDStudio,
} from '../gdStudio';
import { fetchGDStudioData, GDStudioApiError } from '../gdStudioClient';
import { lyricCache, trackMetaCache } from '../gdStudioModel';

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

describe('GD Studio service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lyricCache.clear();
    trackMetaCache.clear();
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
    }));
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
});
