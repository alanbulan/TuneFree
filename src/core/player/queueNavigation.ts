import {
  getNextQueueIndex,
  getPrevQueueIndex,
  getShuffleStepIndex,
  syncShuffleOrder,
} from "../contexts/playerQueue";
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
