import { describe, expect, it } from 'vitest';
import type { Song } from '../../types';
import { getNextRecommendationCandidateIndex } from '../playerQueue';

const song = (id: string, requestId?: string): Song => ({
  id,
  source: 'netease',
  name: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  recommendationRequestId: requestId,
});

describe('getNextRecommendationCandidateIndex', () => {
  it('returns the next unfailed song from the same recommendation request', () => {
    const queue = [song('1', 'request-a'), song('2', 'request-a'), song('3', 'request-b')];
    expect(getNextRecommendationCandidateIndex(queue, queue[0], new Set())).toBe(1);
  });

  it('skips failed candidates and wraps within the queue', () => {
    const queue = [song('1', 'request-a'), song('2', 'request-a'), song('3', 'request-a')];
    const failed = new Set(['netease:1', 'netease:3']);
    expect(getNextRecommendationCandidateIndex(queue, queue[2], failed)).toBe(1);
  });

  it('does not cross recommendation request boundaries', () => {
    const queue = [song('1', 'request-a'), song('2', 'request-b')];
    expect(getNextRecommendationCandidateIndex(queue, queue[0], new Set(['netease:1']))).toBe(-1);
  });

  it('returns -1 for non-recommendation songs', () => {
    const queue = [song('1'), song('2')];
    expect(getNextRecommendationCandidateIndex(queue, queue[0], new Set())).toBe(-1);
  });
});
