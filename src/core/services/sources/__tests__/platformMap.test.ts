import { describe, expect, it } from 'vitest';
import {
  buildMusicInfo,
  declarationPlatform,
  pickQuality,
  toAppPlatform,
  toLxPlatform,
} from '../platformMap';
import type { SourceResolveRequest } from '../types';

const request = (overrides: Partial<SourceResolveRequest> = {}): SourceResolveRequest => ({
  platform: 'netease',
  id: 42,
  quality: '320k',
  ...overrides,
});

describe('platformMap', () => {
  it('洛雪平台键与应用平台键互转', () => {
    expect(toAppPlatform('wy')).toBe('netease');
    expect(toAppPlatform('tx')).toBe('qq');
    expect(toAppPlatform('kw')).toBe('kuwo');
    expect(toAppPlatform('kg')).toBe('kugou');
    expect(toAppPlatform('mg')).toBe('migu');
    expect(toAppPlatform('local')).toBeNull();
    expect(toAppPlatform('unknown')).toBeNull();
    // GD 专属平台是给内置脚本用的扩展键（洛雪词表里没有）
    expect(toAppPlatform('joox')).toBe('joox');
    expect(toAppPlatform('bilibili')).toBe('bilibili');
    expect(toLxPlatform('netease')).toBe('wy');
    expect(toLxPlatform('kugou')).toBe('kg');
    expect(toLxPlatform('joox')).toBe('joox');
    expect(toLxPlatform('embeat')).toBeNull();
  });

  it('音质挑选：精确命中、降级、空列表与未声明', () => {
    expect(pickQuality('320k', ['128k', '320k', 'flac'])).toBe('320k');
    expect(pickQuality('flac24bit', undefined)).toBe('flac24bit');
    expect(pickQuality('flac24bit', ['128k', '320k', 'flac'])).toBe('flac');
    expect(pickQuality('flac', ['128k', '320k'])).toBe('320k');
    expect(pickQuality('flac24bit', ['128k'])).toBe('128k');
    // 声明里没有降级顺序内的音质时退回首个声明值。
    expect(pickQuality('320k', ['hires', 'jymaster'])).toBe('hires');
    // 空数组表示该平台不提供可用链接。
    expect(pickQuality('320k', [])).toBeNull();
  });

  it('构造 musicInfo 时覆盖洛雪音源实际读取的字段', () => {
    const info = buildMusicInfo(request({ name: '歌名', artist: '歌手', album: '专辑' }));
    expect(info).toMatchObject({
      id: '42',
      songmid: '42',
      name: '歌名',
      singer: '歌手',
      album: '专辑',
      albumName: '专辑',
      interval: 0,
    });
    expect(info._types).toEqual({});
    expect(info.albumId).toBe('');
    // 缺 id（按歌名匹配兜底）时字段退化为空串而不是 undefined。
    expect(buildMusicInfo(request({ id: '' })).songmid).toBe('');
    // 酷狗：hash 与音质级 hash 都要透传给脚本
    expect(
      buildMusicInfo(
        request({ platform: 'kugou', id: 'FILE_HASH', hash: 'FILE_HASH', albumId: '966846', qualityHashes: { flac: { hash: 'SQ' } } }),
      ),
    ).toMatchObject({ hash: 'FILE_HASH', albumId: '966846', _types: { flac: { hash: 'SQ' } } });
    // 未提供 hash 时退回主键
    expect(buildMusicInfo(request({ id: 7 })).hash).toBe('7');
    expect(buildMusicInfo({ platform: 'kugou', id: 1, quality: '320k' })).toMatchObject({
      name: '',
      singer: '',
      album: '',
    });
  });

  it('声明解析：转换平台键并补齐默认 actions', () => {
    expect(declarationPlatform('kw', { qualitys: ['320k'] })).toEqual({
      appPlatform: 'kuwo',
      actions: ['musicUrl'],
      qualitys: ['320k'],
    });
    expect(declarationPlatform('wy', { actions: ['musicUrl', 'lyric'], qualitys: [] })).toEqual({
      appPlatform: 'netease',
      actions: ['musicUrl', 'lyric'],
      qualitys: [],
    });
    expect(declarationPlatform('local', {})).toBeNull();
    expect(declarationPlatform('mg', {})).toEqual({
      appPlatform: 'migu',
      actions: ['musicUrl'],
      qualitys: undefined,
    });
  });
});
