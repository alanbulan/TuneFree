import { describe, expect, it } from 'vitest';
import {
  getTrackKey,
  joinArtists,
  normalizeBitrate,
  normalizeGDStudioSource,
  toGDStudioApiSource,
} from '../gdStudioModel';

describe('gdStudioModel', () => {
  it('来源与音质映射', () => {
    expect(toGDStudioApiSource('qq')).toBe('tencent');
    expect(toGDStudioApiSource('netease')).toBe('netease');
    expect(normalizeGDStudioSource('TENCENT')).toBe('qq');
    expect(normalizeGDStudioSource('joox')).toBe('joox');
    expect(normalizeGDStudioSource('unknown')).toBeNull();
    expect(normalizeGDStudioSource(undefined)).toBeNull();
    expect(normalizeBitrate('128k')).toBe('128');
    expect(normalizeBitrate('flac24bit')).toBe('999');
    expect(normalizeBitrate('unknown')).toBe('320');
  });

  it('歌手拼接与 track key', () => {
    expect(joinArtists(['A', 'B'])).toBe('A, B');
    expect(joinArtists('独唱')).toBe('独唱');
    expect(joinArtists(undefined)).toBe('');
    expect(getTrackKey(12, 'qq')).toBe('qq:12');
  });
});
