let generation = 0;

/** Account and source changes share a generation so playback caches expire immediately. */
export const getPlaybackGeneration = (): number => generation;
export const invalidatePlayback = (): void => { generation += 1; };
