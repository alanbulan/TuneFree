import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mapGDStudioTracks } from '../gdStudio';
import {
  buildGDStudioRequestBody,
  classifyGDStudioFailure,
  GDStudioApiError,
} from '../gdStudioClient';
import {
  GD_STUDIO_MUSIC_SOURCES,
  GD_STUDIO_ONLY_SOURCES,
  normalizeGDStudioSource,
  toGDStudioApiSource,
} from '../gdStudioModel';
import { SEARCH_SOURCE_OPTIONS } from '../../utils/musicSource';

describe('GD Studio source registry', () => {
  it('contains every documented source exactly once', () => {
    expect(GD_STUDIO_MUSIC_SOURCES).toEqual([
      'netease', 'qq', 'kuwo', 'tidal', 'qobuz',
      'joox', 'bilibili', 'apple', 'ytmusic', 'spotify',
    ]);
    expect(new Set(GD_STUDIO_MUSIC_SOURCES).size).toBe(GD_STUDIO_MUSIC_SOURCES.length);
    expect(SEARCH_SOURCE_OPTIONS).toEqual(GD_STUDIO_MUSIC_SOURCES);
    expect(GD_STUDIO_ONLY_SOURCES).toEqual([
      'tidal', 'qobuz', 'joox', 'bilibili', 'apple', 'ytmusic', 'spotify',
    ]);
    expect(toGDStudioApiSource('qq')).toBe('tencent');
    expect(normalizeGDStudioSource('tencent')).toBe('qq');
  });

  it('encodes the keyword once and maps the canonical QQ source', async () => {
    const body = await buildGDStudioRequestBody({
      types: 'search', source: 'qq', name: '周杰伦', count: 20, pages: 1,
    }, 1_783_745_000_000);

    expect(body.get('name')).toBe('周杰伦');
    expect(body.get('source')).toBe('tencent');
    const expectedSignature = createHash('md5')
      .update('178374500|music.gdstudio.org|20260616|%E5%91%A8%E6%9D%B0%E4%BC%A6')
      .digest('hex')
      .slice(-8)
      .toUpperCase();
    expect(body.get('s')).toBe(expectedSignature);
    expect(body.toString()).toContain('name=%E5%91%A8%E6%9D%B0%E4%BC%A6');
    expect(body.toString()).not.toContain('%25E5');
  });

  it('classifies service failures consistently', () => {
    expect(classifyGDStudioFailure(400, 'Value of source is not supported.'))
      .toBe('UNSUPPORTED_SOURCE');
    expect(classifyGDStudioFailure(429, 'Too many requests')).toBe('RATE_LIMIT');
    expect(classifyGDStudioFailure(503, 'Service unavailable')).toBe('UNAVAILABLE');
    expect(classifyGDStudioFailure(200, '<html>invalid response</html>')).toBe('BAD_RESPONSE');
  });
});

describe('mapGDStudioTracks', () => {
  it('canonicalizes Tencent and removes duplicate source-track identities', () => {
    const tracks = mapGDStudioTracks([
      {
        id: '003', name: 'Song', artist: ['Artist'], album: 'Album',
        pic_id: 'pic', url_id: 'url', lyric_id: 'lyric', source: 'tencent',
      },
      {
        id: '003', name: 'Duplicate', artist: ['Artist'], album: 'Album',
        pic_id: 'pic2', url_id: 'url2', lyric_id: 'lyric2', source: 'tencent',
      },
    ], 'qq');

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ id: '003', source: 'qq', name: 'Song' });
  });

  it('rejects missing identities and cross-source responses', () => {
    expect(() => mapGDStudioTracks([
      { name: 'Missing id', source: 'joox' },
    ], 'joox')).toThrow(GDStudioApiError);
    expect(() => mapGDStudioTracks([
      {
        id: '1', name: 'Wrong source', artist: [], album: '', pic_id: '',
        url_id: '1', lyric_id: '1', source: 'kuwo',
      },
    ], 'joox')).toThrow(/source mismatch/);
  });

  it('rejects non-object tracks and invalid field types', () => {
    expect(() => mapGDStudioTracks([null], 'joox')).toThrow(/track must be an object/);
    expect(() => mapGDStudioTracks([{
      id: '1', name: 'Invalid artist', artist: {}, album: '', pic_id: '',
      url_id: '1', lyric_id: '1', source: 'joox',
    }], 'joox')).toThrow(/invalid types/);
  });
});
