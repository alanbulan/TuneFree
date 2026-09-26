import {
  getNextQueueIndex,
  getPrevQueueIndex,
  getShuffleStepIndex,
  syncShuffleOrder,
} from "../contexts/playerQueue";
import { getSongKey } from "../types";
import type { Song } from "../types";
import type { PlayerRefs } from "./types";

/**
 * Resolve the queue index one step away from `currentSong`, keeping the shuffle order table in
 * `refs.shuffleOrder` reconciled with the live queue. Peeking (preload) and committing (playNext)
 * both go through here, so they always agree on the same target instead of re-rolling the dice.
 */
export const resolveQueueStepIndex = (
  refs: PlayerRefs,
  currentSong: Song | null,
  step: 1 | -1,
): number => {
  const queue = refs.queue.current;
  const playMode = refs.playMode.current;
  if (queue.length === 0) return -1;
  if (playMode !== "shuffle") {
    return step > 0
      ? getNextQueueIndex(queue, currentSong, playMode)
      : getPrevQueueIndex(queue, currentSong, playMode);
  }
  const order = syncShuffleOrder(refs.shuffleOrder.current, queue);
  refs.shuffleOrder.current = order;
  return getShuffleStepIndex(order, queue, currentSong, step);
};

/**
 * 播放失败后的下一首：沿用正常的「下一首」顺序，跳过本轮已经失败的歌曲；整圈都失败时返回 -1。
 * 单曲循环时当前歌曲已不可播放，因此同样按列表顺序往后找。
 */
export const resolveNextPlayableIndex = (
  refs: PlayerRefs,
  currentSong: Song,
  failedKeys: ReadonlySet<string>,
): number => {
  const queue = refs.queue.current;
  let cursor = currentSong;
  for (let attempt = 0; attempt < queue.length; attempt += 1) {
    const index = resolveQueueStepIndex(refs, cursor, 1);
    const candidate = queue[index];
    if (!candidate) return -1;
    if (!failedKeys.has(getSongKey(candidate))) return index;
    cursor = candidate;
  }
  return -1;
};
