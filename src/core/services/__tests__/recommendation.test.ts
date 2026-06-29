import { describe, expect, it } from 'vitest';
import {
  attachRecommendationMeta,
  getHomeRecommendations,
  logRecommendationEvent,
} from '../recommendation';
import type { RecommendationItem } from '../recommendation';

describe('recommendation service', () => {
  it('returns empty results outside Tauri', async () => {
    await expect(getHomeRecommendations({ limit: 10 })).resolves.toEqual([]);
    await expect(logRecommendationEvent({ eventType: 'play_start' })).resolves.toBeUndefined();
  });

  it('attaches recommendation metadata to songs', () => {
    const items: RecommendationItem[] = [
      {
        song: {
          id: '1',
          source: 'netease',
          name: 'Song',
          artist: 'Artist',
          album: 'Album',
        },
        score: 0.8,
        reasons: ['因为你常听 Artist'],
        recommendationSource: 'local',
        requestId: 'rec-1',
      },
    ];

    expect(attachRecommendationMeta(items)).toEqual([
      {
        id: '1',
        source: 'netease',
        name: 'Song',
        artist: 'Artist',
        album: 'Album',
        recommendationReasons: ['因为你常听 Artist'],
        recommendationSource: 'local',
        recommendationRequestId: 'rec-1',
        recommendationScore: 0.8,
      },
    ]);
  });
});
