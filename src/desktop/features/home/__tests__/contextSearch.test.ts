import { describe, expect, it } from 'vitest';
import type { Song } from '../../../../core/types';
import { attachContextSearchMeta, isCurrentContextSearch } from '../contextSearch';

const song = (source: string, id: string): Song => ({
  source,
  id,
  name: `${source}-${id}`,
  artist: 'artist',
  album: 'album',
});

describe('context search state', () => {
  it('attaches one request identity to the whole generated queue', () => {
    const songs = attachContextSearchMeta([
      song('embeat', '1'),
      song('netease', '2'),
    ], 'embeat-request-1');

    expect(songs.every((item) => item.recommendationRequestId === 'embeat-request-1')).toBe(true);
    expect(songs.every((item) => item.recommendationSource === 'embeat')).toBe(true);
  });

  it('rejects stale responses and responses after leaving the Embeat tab', () => {
    expect(isCurrentContextSearch(2, 2, 'embeat')).toBe(true);
    expect(isCurrentContextSearch(1, 2, 'embeat')).toBe(false);
    expect(isCurrentContextSearch(2, 2, 'netease')).toBe(false);
  });
});
