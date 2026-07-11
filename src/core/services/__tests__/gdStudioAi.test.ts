import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gdStudioClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../gdStudioClient')>();
  return {
    ...actual,
    fetchGDStudioData: vi.fn(),
    fetchWithTimeout: vi.fn(),
  };
});

import {
  loadAIRecommendationTracks,
  mapAIRecommendationTracks,
} from '../gdStudioAi';
import {
  fetchGDStudioData,
  fetchWithTimeout,
  GDStudioApiError,
} from '../gdStudioClient';
import type { GdStudioTrack } from '../gdStudioModel';

const mockedFetchData = vi.mocked(fetchGDStudioData);
const mockedFetchWithTimeout = vi.mocked(fetchWithTimeout);

const track = (overrides: Partial<GdStudioTrack> = {}): GdStudioTrack => ({
  id: 'embeatsong-1',
  name: '修炼爱情',
  artist: ['林俊杰'],
  album: '因你而在',
  pic_id: 'https://example.com/cover.jpg',
  url_id: 'url-1',
  lyric_id: 'lyric-1',
  source: 'embeat',
  ...overrides,
});

describe('GD Studio AI recommendation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserves embeat identity and deduplicates by source:id', () => {
    const songs = mapAIRecommendationTracks([track(), track({ name: '重复项' })]);
    expect(songs).toHaveLength(1);
    expect(songs[0]).toMatchObject({ id: 'embeatsong-1', source: 'embeat' });
  });

  it('rejects tracks without a stable identity', () => {
    expect(() => mapAIRecommendationTracks([track({ id: '' })]))
      .toThrow(GDStudioApiError);
  });

  it('strictly parses Pollinations content and only searches recommended songs', async () => {
    mockedFetchData
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([track({ id: '1', source: 'netease' })])
      .mockResolvedValueOnce([track({ id: '2', source: 'netease', name: '江南' })]);
    mockedFetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify([
        { name: '修炼爱情', artist: '林俊杰' },
        { name: '江南', artist: '林俊杰' },
      ]) } }],
    }), { status: 200 }));

    const result = await loadAIRecommendationTracks('雨夜独处', 'netease', 20);

    expect(result).toHaveLength(2);
    expect(mockedFetchData).toHaveBeenCalledTimes(3);
    expect(mockedFetchData).toHaveBeenNthCalledWith(2, expect.objectContaining({
      types: 'search', name: '修炼爱情 林俊杰', source: 'netease', count: 1,
    }), undefined);
    expect(mockedFetchWithTimeout).toHaveBeenCalledWith(
      'https://text.pollinations.ai/openai',
      expect.objectContaining({ method: 'POST' }),
      12_000,
    );
    const pollinationsBody = JSON.parse(String(mockedFetchWithTimeout.mock.calls[0]?.[1].body));
    expect(pollinationsBody).toMatchObject({
      model: 'openai-fast', temperature: 0.4, max_tokens: 2_000, reasoning_effort: 'low',
    });
  });

  it('keeps resolvable Pollinations songs when another recommendation is missing', async () => {
    mockedFetchData
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([track({ id: 'wrong', source: 'netease', name: '完全不同' })])
      .mockResolvedValueOnce([track({ id: '2', source: 'netease', name: '江南' })]);
    mockedFetchWithTimeout.mockResolvedValue(new Response(JSON.stringify([
      { name: '不存在的歌', artist: '未知歌手' },
      { name: '江南', artist: '林俊杰' },
    ]), { status: 200 }));

    await expect(loadAIRecommendationTracks('雨夜独处', 'netease', 20))
      .resolves.toHaveLength(1);
  });

  it('trusts the searched source metadata when Pollinations gives the wrong artist', async () => {
    mockedFetchData
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([track({
        id: 'rain-1', source: 'netease', name: '雨天', artist: ['孙燕姿'],
      })]);
    mockedFetchWithTimeout.mockResolvedValue(new Response(JSON.stringify([
      { name: '雨天', artist: '林宥嘉' },
    ]), { status: 200 }));

    const result = await loadAIRecommendationTracks('下雨天的咖啡馆', 'netease', 20);
    expect(result[0]).toMatchObject({ name: '雨天', artist: ['孙燕姿'] });
  });

  it('propagates failure when official and Pollinations chains both fail', async () => {
    mockedFetchData.mockRejectedValueOnce(new Error('official unavailable'));
    mockedFetchWithTimeout.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { reasoning: 'not accepted', tool_calls: [] } }],
    }), { status: 200 }));

    await expect(loadAIRecommendationTracks('雨夜独处', 'netease', 20))
      .rejects.toThrow(/embeat_agent failed.*Pollinations failed/);
    expect(mockedFetchData).toHaveBeenCalledTimes(1);
  });

  it('does not start external requests after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(loadAIRecommendationTracks('雨夜独处', 'netease', 20, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect(mockedFetchData).not.toHaveBeenCalled();
    expect(mockedFetchWithTimeout).not.toHaveBeenCalled();
  });
});
