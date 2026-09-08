import { describe, expect, it } from 'vitest';
import { getSongKey, type Song } from '../../types';
import {
  getNextQueueIndex,
  getNextRecommendationCandidateIndex,
  getPrevQueueIndex,
  getShuffleStepIndex,
  syncShuffleOrder,
} from '../playerQueue';

const song = (id: string, requestId?: string): Song => ({
  id,
  source: 'netease',
  name: `Song ${id}`,
  artist: 'Artist',
  album: 'Album',
  recommendationRequestId: requestId,
});

const makeQueue = (count: number) =>
  Array.from({ length: count }, (_, index) => song(String(index + 1)));

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

describe('shuffle order table', () => {
  it('draws every queue member exactly once', () => {
    const queue = makeQueue(8);
    const order = syncShuffleOrder(null, queue);
    expect([...order.keys].sort()).toEqual(queue.map(getSongKey).sort());
  });

  it('reuses the same table while the queue membership is unchanged', () => {
    const queue = makeQueue(6);
    const order = syncShuffleOrder(null, queue);
    // 预加载后队列会被 patch 成新数组，但成员没变，顺序表必须原样复用。
    expect(syncShuffleOrder(order, queue.map((item) => ({ ...item, url: 'x' })))).toBe(order);
  });

  it('keeps the drawn positions of surviving songs when the queue changes', () => {
    const queue = makeQueue(4);
    const order = syncShuffleOrder(null, queue);
    const removedKey = order.keys[1];
    const shrunk = queue.filter((item) => getSongKey(item) !== removedKey);
    const next = syncShuffleOrder(order, [...shrunk, song('99')]);
    expect(next.keys).not.toBe(order.keys);
    expect(next.keys.slice(0, 3)).toEqual(order.keys.filter((key) => key !== removedKey));
    expect(next.keys[3]).toBe('netease:99');
  });

  it('returns a stable next song instead of re-rolling the dice', () => {
    const queue = makeQueue(10);
    const order = syncShuffleOrder(null, queue);
    const first = getShuffleStepIndex(order, queue, queue[0], 1);
    expect(getShuffleStepIndex(order, queue, queue[0], 1)).toBe(first);
    expect(getShuffleStepIndex(order, queue, queue[0], 1)).toBe(first);
  });

  it('makes "previous" walk back to the song that was actually played before', () => {
    const queue = makeQueue(10);
    const order = syncShuffleOrder(null, queue);
    const nextIndex = getShuffleStepIndex(order, queue, queue[3], 1);
    expect(getShuffleStepIndex(order, queue, queue[nextIndex], -1)).toBe(3);
    const routedNext = getNextQueueIndex(queue, queue[3], 'shuffle', order);
    expect(routedNext).toBe(nextIndex);
    expect(getPrevQueueIndex(queue, queue[routedNext], 'shuffle', order)).toBe(3);
  });

  it('wraps around the drawn order in both directions', () => {
    const queue = makeQueue(3);
    const order = syncShuffleOrder(null, queue);
    const lastKey = order.keys[order.keys.length - 1];
    const lastSong = queue.find((item) => getSongKey(item) === lastKey)!;
    const firstIndex = queue.findIndex((item) => getSongKey(item) === order.keys[0]);
    expect(getShuffleStepIndex(order, queue, lastSong, 1)).toBe(firstIndex);
    expect(getShuffleStepIndex(order, queue, queue[firstIndex], -1))
      .toBe(queue.indexOf(lastSong));
  });

  it('starts from either end of the table when the current song left the queue', () => {
    const queue = makeQueue(4);
    const order = syncShuffleOrder(null, queue);
    expect(getShuffleStepIndex(order, queue, song('404'), 1))
      .toBe(queue.findIndex((item) => getSongKey(item) === order.keys[0]));
    expect(getShuffleStepIndex(order, queue, null, -1))
      .toBe(queue.findIndex((item) => getSongKey(item) === order.keys[3]));
  });

  it('keeps sequential stepping untouched outside shuffle mode', () => {
    const queue = makeQueue(3);
    expect(getNextQueueIndex(queue, queue[2], 'sequence')).toBe(0);
    expect(getPrevQueueIndex(queue, queue[0], 'sequence')).toBe(2);
    expect(getNextQueueIndex([], null, 'shuffle')).toBe(-1);
  });
});
