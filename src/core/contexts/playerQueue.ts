import { PlayMode, Song, getSongKey, isSameSong } from "../types";

export const findCurrentSongIndex = (
  queue: Song[],
  currentSong: Song | null,
): number => {
  if (!currentSong) return -1;
  return queue.findIndex((song) => isSameSong(song, currentSong));
};

export const getNextQueueIndex = (
  queue: Song[],
  currentSong: Song | null,
  playMode: PlayMode,
): number => {
  if (queue.length === 0) return -1;

  const currentIndex = findCurrentSongIndex(queue, currentSong);
  if (playMode === "shuffle") {
    let nextIndex = 0;
    do {
      nextIndex = Math.floor(Math.random() * queue.length);
    } while (queue.length > 1 && nextIndex === currentIndex);
    return nextIndex;
  }

  return (currentIndex + 1) % queue.length;
};

export const getPrevQueueIndex = (
  queue: Song[],
  currentSong: Song | null,
  playMode: PlayMode,
): number => {
  if (queue.length === 0) return -1;

  const currentIndex = findCurrentSongIndex(queue, currentSong);
  if (playMode === "shuffle") {
    let prevIndex = 0;
    do {
      prevIndex = Math.floor(Math.random() * queue.length);
    } while (queue.length > 1 && prevIndex === currentIndex);
    return prevIndex;
  }

  return (currentIndex - 1 + queue.length) % queue.length;
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
