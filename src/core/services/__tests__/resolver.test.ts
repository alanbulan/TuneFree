import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the service modules to isolate resolver logic
vi.mock('../netease', () => ({
  searchNetease: vi.fn(),
  fetchNeteaselyrics: vi.fn(),
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

import { fetchNativeUrl, getSongUrl } from '../resolver';
import { searchNetease } from '../netease';
import { searchQQ } from '../qq';

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
});
