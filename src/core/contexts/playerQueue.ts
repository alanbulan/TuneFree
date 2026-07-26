import { PlayMode, Song, getSongKey, isSameSong } from "../types";

/**
 * One-shot shuffle order table. Random picking per step made "previous" unreachable and made the
 * preload effect re-resolve a different song on every queue patch, so the order is drawn once and
 * reused until the queue membership actually changes.
 */
export interface ShuffleOrder {
  /** 队列成员签名，用于快速判断顺序表是否仍然有效。 */
  signature: string;
  /** 打乱后的歌曲键序列。 */
  keys: string[];
}

export const findCurrentSongIndex = (
  queue: Song[],
  currentSong: Song | null,
): number => {
  if (!currentSong) return -1;
  return queue.findIndex((song) => isSameSong(song, currentSong));
};

export const getQueueSignature = (queue: Song[]): string =>
  queue.map(getSongKey).join("|");

const shuffleKeys = (keys: string[]): string[] => {
  const result = [...keys];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    const swapped = result[index];
    result[index] = result[target];
    result[target] = swapped;
  }
  return result;
};

/**
 * Reconcile an existing order with the current queue: songs still present keep their drawn
 * position, removed songs drop out and newly added songs are shuffled onto the tail.
 */
export const syncShuffleOrder = (
  order: ShuffleOrder | null,
  queue: Song[],
): ShuffleOrder => {
  const signature = getQueueSignature(queue);
  if (order && order.signature === signature) return order;
  const queueKeys = Array.from(new Set(queue.map(getSongKey)));
  const present = new Set(queueKeys);
  const retained = order ? order.keys.filter((key) => present.has(key)) : [];
  if (retained.length === 0) return { signature, keys: shuffleKeys(queueKeys) };
  const retainedKeys = new Set(retained);
  const added = shuffleKeys(queueKeys.filter((key) => !retainedKeys.has(key)));
  return { signature, keys: [...retained, ...added] };
};

/** Resolve the queue index `step` positions away from the current song inside the shuffle order. */
export const getShuffleStepIndex = (
  order: ShuffleOrder,
  queue: Song[],
  currentSong: Song | null,
  step: 1 | -1,
): number => {
  const total = order.keys.length;
  if (queue.length === 0 || total === 0) return -1;
  const currentKey = currentSong ? getSongKey(currentSong) : null;
  const cursor = currentKey ? order.keys.indexOf(currentKey) : -1;
  const nextCursor = cursor < 0
    ? (step > 0 ? 0 : total - 1)
    : (cursor + step + total) % total;
  const nextKey = order.keys[nextCursor];
  return queue.findIndex((song) => getSongKey(song) === nextKey);
};

export const getNextQueueIndex = (
  queue: Song[],
  currentSong: Song | null,
  playMode: PlayMode,
  shuffleOrder: ShuffleOrder | null = null,
): number => {
  if (queue.length === 0) return -1;
  if (playMode === "shuffle") {
    return getShuffleStepIndex(syncShuffleOrder(shuffleOrder, queue), queue, currentSong, 1);
  }
  return (findCurrentSongIndex(queue, currentSong) + 1) % queue.length;
};

export const getPrevQueueIndex = (
  queue: Song[],
  currentSong: Song | null,
  playMode: PlayMode,
  shuffleOrder: ShuffleOrder | null = null,
): number => {
  if (queue.length === 0) return -1;
  if (playMode === "shuffle") {
    return getShuffleStepIndex(syncShuffleOrder(shuffleOrder, queue), queue, currentSong, -1);
  }
  return (findCurrentSongIndex(queue, currentSong) - 1 + queue.length) % queue.length;
};

export const getNextRecommendationCandidateIndex = (
  queue: Song[],
  currentSong: Song | null,
  failedSongKeys: ReadonlySet<string>,
): number => {
  if (!currentSong?.recommendationRequestId || queue.length < 2) return -1;

  const currentIndex = findCurrentSongIndex(queue, currentSong);
  if (currentIndex < 0) return -1;

  for (let offset = 1; offset < queue.length; offset += 1) {
    const candidateIndex = (currentIndex + offset) % queue.length;
    const candidate = queue[candidateIndex];
    if (
      candidate?.recommendationRequestId === currentSong.recommendationRequestId &&
      !failedSongKeys.has(getSongKey(candidate))
    ) {
      return candidateIndex;
    }
  }

  return -1;
};
