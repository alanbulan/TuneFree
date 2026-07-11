import { describe, expect, it } from 'vitest';
import type { Song } from '../../../../core/types';
import { mergeSearchPage } from '../searchPagination';

const song = (source: string, id: string): Song => ({
  source,
  id,
  name: `${source}-${id}`,
  artist: 'artist',
  album: 'album',
});

describe('mergeSearchPage', () => {
  it('deduplicates within and across pages while preserving cross-source ids', () => {
    const previous = [song('netease', '1'), song('qq', '2')];
    const incoming = [song('netease', '1'), song('qq', '1'), song('kuwo', '3'), song('kuwo', '3')];
    const result = mergeSearchPage(previous, incoming, false);

    expect(result.songs.map((item) => `${item.source}:${item.id}`)).toEqual([
      'netease:1', 'qq:2', 'qq:1', 'kuwo:3',
    ]);
    expect(result.addedCount).toBe(2);
    expect(result.hasMore).toBe(true);
  });

  it('stops pagination when a non-empty page contains no new songs', () => {
    const previous = [song('netease', '1'), song('qq', '2')];
    const result = mergeSearchPage(previous, [song('qq', '2'), song('netease', '1')], false);

    expect(result.songs).toEqual(previous);
    expect(result.addedCount).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('replaces old results on the first page and stops on an empty page', () => {
    const oldResults = [song('netease', 'old')];
    const firstPage = mergeSearchPage(oldResults, [song('qq', '1'), song('qq', '1')], true);
    const emptyPage = mergeSearchPage(firstPage.songs, [], false);

    expect(firstPage.songs.map((item) => `${item.source}:${item.id}`)).toEqual(['qq:1']);
    expect(firstPage.hasMore).toBe(true);
    expect(emptyPage.hasMore).toBe(false);
  });
});
