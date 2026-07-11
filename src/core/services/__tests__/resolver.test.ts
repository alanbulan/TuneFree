import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the service modules to isolate resolver logic
vi.mock('../netease', () => ({
  searchNetease: vi.fn(),
  fetchNeteaseLyrics: vi.fn(),
}));
vi.mock('../qq', () => ({
  searchQQ: vi.fn(),
  fetchQQLyrics: vi.fn(),
  qqMusicuFetch: vi.fn(),
}));
vi.mock('../kuwo', () => ({
  searchKuwo: vi.fn(),
  fetchKuwoLyrics: vi.fn(),
  batchFetchKuwoCovers: vi.fn(),
}));
vi.mock('../gdStudio', () => ({
  getGDStudioLyrics: vi.fn(),
  getGDStudioSongUrl: vi.fn(),
  isGDStudioOnlySource: vi.fn().mockReturnValue(false),
  isGDStudioSource: vi.fn().mockReturnValue(false),
  parseGDStudioSongFull: vi.fn(),
  searchGDStudio: vi.fn(),
}));

import { fetchFallbackLyrics, fetchNativeUrl, getLyrics, getSongUrl, parseSongFull } from '../resolver';
import { fetchNeteaseLyrics, searchNetease } from '../netease';
import { searchQQ } from '../qq';
import { searchKuwo } from '../kuwo';
import {
  getGDStudioLyrics,
  getGDStudioSongUrl,
  isGDStudioOnlySource,
  parseGDStudioSongFull,
} from '../gdStudio';

describe('fetchNativeUrl', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should return URL when API responds successfully', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://example.com/song.mp3' }),
    });
    globalThis.fetch = mockFetch as any;

    const result = await fetchNativeUrl('123', 'netease', '320k');
    expect(result).toBe('https://example.com/song.mp3');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('platform=netease');
    expect(calledUrl).toContain('id=123');
    expect(calledUrl).toContain('quality=320k');
  });

  it('should return null when API responds non-ok status', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
    }) as any;

    const result = await fetchNativeUrl('123', 'netease', '320k');
    expect(result).toBeNull();
  });

  it('should return null when response has no url field', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ error: 'not found' }),
    }) as any;

    const result = await fetchNativeUrl('123', 'netease', '320k');
    expect(result).toBeNull();
  });

  it('should return null on network error', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

    const result = await fetchNativeUrl('123', 'netease', '320k');
    expect(result).toBeNull();
  });

  it('should URL-encode platform and id parameters', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://example.com/song.mp3' }),
    });
    globalThis.fetch = mockFetch as any;

    await fetchNativeUrl('test&id', 'netease', '128k');
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain('id=test%26id');
  });

  it('should abort native URL resolution after the request timeout', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn((_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }) as any;

    try {
      const request = fetchNativeUrl('timeout', 'netease', '320k');
      await vi.advanceTimersByTimeAsync(8_000);

      await expect(request).resolves.toBeNull();
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchFallbackLyrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not permanently cache an empty lyric result', async () => {
    vi.mocked(fetchNeteaseLyrics)
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('[00:01.00]retry succeeded');

    await expect(fetchFallbackLyrics('empty-retry', 'netease')).resolves.toBe('');
    await expect(fetchFallbackLyrics('empty-retry', 'netease')).resolves.toBe(
      '[00:01.00]retry succeeded',
    );
    expect(fetchNeteaseLyrics).toHaveBeenCalledTimes(2);
  });

  it('caches a successful lyric result', async () => {
    vi.mocked(fetchNeteaseLyrics).mockResolvedValue('[00:01.00]cached');

    await expect(fetchFallbackLyrics('successful-cache', 'netease')).resolves.toBe(
      '[00:01.00]cached',
    );
    await expect(fetchFallbackLyrics('successful-cache', 'netease')).resolves.toBe(
      '[00:01.00]cached',
    );
    expect(fetchNeteaseLyrics).toHaveBeenCalledTimes(1);
  });

  it('shares an in-flight lyric request and clears it after failure', async () => {
    let rejectRequest: ((reason?: unknown) => void) | undefined;
    vi.mocked(fetchNeteaseLyrics).mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );

    const first = fetchFallbackLyrics('pending-failure', 'netease');
    const second = fetchFallbackLyrics('pending-failure', 'netease');
    expect(fetchNeteaseLyrics).toHaveBeenCalledTimes(1);

    rejectRequest?.(new Error('network failure'));
    await expect(first).resolves.toBe('');
    await expect(second).resolves.toBe('');

    vi.mocked(fetchNeteaseLyrics).mockResolvedValueOnce('[00:02.00]recovered');
    await expect(fetchFallbackLyrics('pending-failure', 'netease')).resolves.toBe(
      '[00:02.00]recovered',
    );
    expect(fetchNeteaseLyrics).toHaveBeenCalledTimes(2);
  });
});

describe('GD Studio direct resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isGDStudioOnlySource).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(isGDStudioOnlySource).mockReturnValue(false);
  });

  it('uses the requested source exactly once without cross-source fallback', async () => {
    vi.mocked(getGDStudioSongUrl).mockResolvedValue('https://example.com/tidal.flac');

    await expect(getSongUrl('track-1', 'tidal', 'flac')).resolves.toBe(
      'https://example.com/tidal.flac',
    );
    expect(getGDStudioSongUrl).toHaveBeenCalledWith('track-1', 'tidal', 'flac');
    expect(getGDStudioSongUrl).toHaveBeenCalledTimes(1);
    expect(searchNetease).not.toHaveBeenCalled();
    expect(searchQQ).not.toHaveBeenCalled();
    expect(searchKuwo).not.toHaveBeenCalled();
  });

  it('propagates GD Studio errors instead of switching sources', async () => {
    vi.mocked(getGDStudioSongUrl).mockRejectedValue(new Error('source is not supported'));

    await expect(getSongUrl('track-2', 'tidal', '320k')).rejects.toThrow(
      'source is not supported',
    );
    expect(searchNetease).not.toHaveBeenCalled();
    expect(searchQQ).not.toHaveBeenCalled();
    expect(searchKuwo).not.toHaveBeenCalled();
  });

  it('resolves lyrics and full data only through the requested GD Studio source', async () => {
    vi.mocked(getGDStudioLyrics).mockResolvedValue('[00:00.00]lyric');
    vi.mocked(parseGDStudioSongFull).mockResolvedValue({
      url: 'https://example.com/qobuz.flac',
      lrc: '[00:00.00]lyric',
      pic: 'https://example.com/cover.jpg',
    });

    await expect(getLyrics('lyric-1', 'qobuz')).resolves.toBe('[00:00.00]lyric');
    await expect(parseSongFull('track-3', 'qobuz', 'flac')).resolves.toMatchObject({
      url: 'https://example.com/qobuz.flac',
    });
    expect(getGDStudioLyrics).toHaveBeenCalledTimes(1);
    expect(getGDStudioLyrics).toHaveBeenCalledWith('lyric-1', 'qobuz');
    expect(parseGDStudioSongFull).toHaveBeenCalledTimes(1);
    expect(parseGDStudioSongFull).toHaveBeenCalledWith('track-3', 'qobuz', 'flac', undefined);
    expect(searchNetease).not.toHaveBeenCalled();
    expect(searchQQ).not.toHaveBeenCalled();
    expect(searchKuwo).not.toHaveBeenCalled();
  });
});

/**
 * isLikelySameSong is not directly exported from resolver.ts.
 * It is an internal function used by resolveFallbackSongFull to filter
 * search candidates before attempting URL resolution.
 *
 * The following tests verify its behavior indirectly through getSongUrl,
 * by mocking the search functions and verifying that only matching
 * candidates are selected for URL resolution.
 */
describe('isLikelySameSong (indirect via getSongUrl)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    // Direct URL resolution always fails to trigger fallback search
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should match candidates with same name and artist', async () => {
    const songMeta = {
      name: 'Test Song',
      artist: 'Test Artist',
      pic: '',
      picId: '',
      urlId: '',
      lyricId: '',
    };

    // Search returns a matching candidate
    vi.mocked(searchNetease).mockResolvedValue([
      {
        id: 'netease123',
        name: 'Test Song',
        artist: 'Test Artist',
        album: '',
        pic: '',
        source: 'netease',
      },
    ]);

    // The fallback URL resolution should succeed
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://example.com/song.mp3' }),
    }) as any;

    const result = await getSongUrl('temp_0', 'kuwo', '320k', songMeta);
    // Should have tried the netease fallback and found the URL
    expect(result).toBe('https://example.com/song.mp3');
  });

  it('should reject candidates with completely different names', async () => {
    const songMeta = {
      name: 'Test Song',
      artist: 'Test Artist',
      pic: '',
      picId: '',
      urlId: '',
      lyricId: '',
    };

    // Search returns a non-matching candidate
    vi.mocked(searchQQ).mockResolvedValue([
      {
        id: 'qq123',
        name: 'Completely Different Song',
        artist: 'Other Artist',
        album: '',
        pic: '',
        source: 'qq',
      },
    ]);
    vi.mocked(searchNetease).mockResolvedValue([]);

    const result = await getSongUrl('temp_0', 'kuwo', '320k', songMeta);
    // Should not find a URL since the candidate doesn't match
    expect(result).toBeNull();
  });

  it('should match candidates with partial name overlap', async () => {
    const songMeta = {
      name: 'Love',
      artist: 'Singer',
      pic: '',
      picId: '',
      urlId: '',
      lyricId: '',
    };

    // Candidate name contains the target name
    vi.mocked(searchQQ).mockResolvedValue([
      {
        id: 'qq456',
        name: 'Love Story',
        artist: 'Singer',
        album: '',
        pic: '',
        source: 'qq',
      },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://example.com/love.mp3' }),
    }) as any;

    const result = await getSongUrl('temp_0', 'netease', '320k', songMeta);
    expect(result).toBe('https://example.com/love.mp3');
  });

  it('should return null when songMeta name is unknown (no fallback query)', async () => {
    const songMeta = {
      name: 'Unknown Song',
      artist: 'Unknown Artist',
      pic: '',
      picId: '',
      urlId: '',
      lyricId: '',
    };

    // When name is "Unknown Song", buildFallbackQuery returns "" (empty),
    // so resolveFallbackSongFull returns null immediately without searching.
    vi.mocked(searchQQ).mockResolvedValue([]);
    vi.mocked(searchNetease).mockResolvedValue([]);

    const result = await getSongUrl('temp_0', 'netease', '320k', songMeta);
    // No fallback search is performed because query is empty
    expect(result).toBeNull();
    expect(searchQQ).not.toHaveBeenCalled();
    expect(searchNetease).not.toHaveBeenCalled();
  });

  it('should handle artist token splitting and partial matching', async () => {
    const songMeta = {
      name: 'Duet Song',
      artist: 'Singer A & Singer B',
      pic: '',
      picId: '',
      urlId: '',
      lyricId: '',
    };

    // Candidate has only one of the two artists
    vi.mocked(searchQQ).mockResolvedValue([
      {
        id: 'qq111',
        name: 'Duet Song',
        artist: 'Singer A',
        album: '',
        pic: '',
        source: 'qq',
      },
    ]);

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ url: 'https://example.com/duet.mp3' }),
    }) as any;

    const result = await getSongUrl('temp_0', 'netease', '320k', songMeta);
    expect(result).toBe('https://example.com/duet.mp3');
  });

  it('resolves a fast fallback source without waiting for a slow source', async () => {
    const songMeta = {
      name: 'Concurrent Song',
      artist: 'Concurrent Artist',
      pic: '',
      picId: '',
      urlId: '',
      lyricId: '',
    };
    let resolveSlowSearch: ((songs: []) => void) | undefined;
    vi.mocked(searchQQ).mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSlowSearch = resolve;
      }),
    );
    vi.mocked(searchNetease).mockResolvedValueOnce([
      {
        id: 'fast-netease-id',
        name: 'Concurrent Song',
        artist: 'Concurrent Artist',
        album: '',
        pic: '',
        source: 'netease',
      },
    ]);
    vi.mocked(fetchNeteaseLyrics).mockResolvedValueOnce('');
    globalThis.fetch = vi.fn((url: string) => Promise.resolve({
      ok: url.includes('platform=netease'),
      json: () => Promise.resolve({ url: 'https://example.com/concurrent.mp3' }),
    })) as any;

    const result = await getSongUrl('temp_concurrent', 'kuwo', '320k', songMeta);
    expect(result).toBe('https://example.com/concurrent.mp3');
    expect(searchQQ).toHaveBeenCalledTimes(1);
    expect(searchNetease).toHaveBeenCalledTimes(1);
    resolveSlowSearch?.([]);
  });

  it('stops fallback resolution at the total timeout', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    vi.mocked(searchQQ).mockReturnValue(never);
    vi.mocked(searchNetease).mockReturnValue(never);

    try {
      const request = getSongUrl('temp_timeout', 'kuwo', '320k', {
        name: 'Timeout Song',
        artist: 'Timeout Artist',
        pic: '',
        picId: '',
        urlId: '',
        lyricId: '',
      });
      await vi.advanceTimersByTimeAsync(15_000);

      await expect(request).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
