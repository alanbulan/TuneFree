import { getSongKey, type Song } from '../../../core/types';

export const mergeSearchPage = (
  previous: Song[],
  incoming: Song[],
  replace: boolean,
): { songs: Song[]; addedCount: number; hasMore: boolean } => {
  const songs = replace ? [] : [...previous];
  const seen = new Set(songs.map(getSongKey));
  let addedCount = 0;

  for (const song of incoming) {
    const key = getSongKey(song);
    if (seen.has(key)) continue;
    seen.add(key);
    songs.push(song);
    addedCount += 1;
  }

  return { songs, addedCount, hasMore: incoming.length > 0 && addedCount > 0 };
};
