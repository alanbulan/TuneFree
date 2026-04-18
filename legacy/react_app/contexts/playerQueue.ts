import { PlayMode, Song, isSameSong } from "../types";

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
    return Math.floor(Math.random() * queue.length);
  }

  return (currentIndex - 1 + queue.length) % queue.length;
};
