import { PlayMode, Song, getSongKey, isSameSong } from "../types";

/**
 * 一次性打乱的顺序表。逐次随机选曲会让「上一首」永远回不去，
 * 也会让预载 effect 每次队列补丁后都换一首解析；所以顺序只抽一次，
 * 队列成员真正变化时才重建。
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
 * 让旧顺序表与当前队列对齐：还在的歌保留原位置，被删的掉出去，
 * 新增的歌打乱后拼到尾部。
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

/** 在顺序表里定位从当前歌曲再走 step 步的队列下标。 */
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
  const nextCursor =
    cursor < 0 ? (step > 0 ? 0 : total - 1) : (cursor + step + total) % total;
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
    return getShuffleStepIndex(
      syncShuffleOrder(shuffleOrder, queue),
      queue,
      currentSong,
      1,
    );
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
    return getShuffleStepIndex(
      syncShuffleOrder(shuffleOrder, queue),
      queue,
      currentSong,
      -1,
    );
  }
  return (findCurrentSongIndex(queue, currentSong) - 1 + queue.length) % queue.length;
};

/**
 * 统一的前后一步解析：预载（peek）和播放（commit）都走这里，
 * 保证它们对同一目标达成一致，而不是各掷一次骰子。
 * 非随机模式不持有顺序表，返回 order: null。
 */
export const resolveQueueStepIndex = (
  shuffleOrder: ShuffleOrder | null,
  queue: Song[],
  currentSong: Song | null,
  playMode: PlayMode,
  step: 1 | -1,
): { index: number; order: ShuffleOrder | null } => {
  if (queue.length === 0) return { index: -1, order: null };
  if (playMode !== "shuffle") {
    const index =
      step > 0
        ? getNextQueueIndex(queue, currentSong, playMode)
        : getPrevQueueIndex(queue, currentSong, playMode);
    return { index, order: null };
  }
  const order = syncShuffleOrder(shuffleOrder, queue);
  return { index: getShuffleStepIndex(order, queue, currentSong, step), order };
};
