import { describe, it, expect } from 'vitest';
import { fixUrl, normalizeSongs, findId, findImage, extractList, extractRawTracks } from '../utils';

describe('fixUrl', () => {
  it('should return empty string for undefined or null', () => {
    expect(fixUrl(undefined)).toBe('');
    expect(fixUrl('')).toBe('');
  });

  it('should complete protocol prefix for // URLs', () => {
    const result = fixUrl('//example.com/image.jpg');
    expect(result).toBe('https://example.com/image.jpg');
  });

  it('should decode HTML entities (&amp; -> &)', () => {
    const result = fixUrl('https://example.com/path?a=1&amp;b=2');
    expect(result).toBe('https://example.com/path?a=1&b=2');
  });

  it('should upgrade netease HTTP to HTTPS', () => {
    const result = fixUrl('http://p1.music.126.net/abc.jpg');
    expect(result).toBe('https://p1.music.126.net/abc.jpg');
  });

  it('should upgrade QQ music HTTP to HTTPS', () => {
    const result = fixUrl('http://y.gtimg.cn/abc.jpg');
    expect(result).toBe('https://y.gtimg.cn/abc.jpg');
  });

  it('should upgrade qpic.cn HTTP to HTTPS', () => {
    const result = fixUrl('http://y.qpic.cn/abc.jpg');
    expect(result).toBe('https://y.qpic.cn/abc.jpg');
  });

  it('should proxy kuwo HTTP URLs through self-hosted proxy', () => {
    const result = fixUrl('http://img1.kuwo.cn/abc.jpg');
    // 浏览器 dev 降级默认：token 为空串，但 token 参数始终在 url= 之前
    expect(result).toContain('/api/cors-proxy?token=&url=');
    expect(result).toContain(encodeURIComponent('http://img1.kuwo.cn/abc.jpg'));
  });

  it('should proxy hdslb.com URLs through self-hosted proxy', () => {
    const result = fixUrl('https://i0.hdslb.com/abc.jpg');
    expect(result).toContain('/api/cors-proxy?token=&url=');
    expect(result).toContain(encodeURIComponent('https://i0.hdslb.com/abc.jpg'));
  });

  it('should upgrade QQ cover size from 300x300 to 500x500', () => {
    const result = fixUrl('https://y.gtimg.cn/music/photo_new/T002R300x300M000abc.jpg');
    expect(result).toContain('500x500');
    expect(result).not.toContain('300x300');
  });

  it('should leave already-HTTPS non-special URLs unchanged', () => {
    const result = fixUrl('https://example.com/image.jpg');
    expect(result).toBe('https://example.com/image.jpg');
  });
});

describe('多平台响应结构', () => {
  const track = { id: 1, name: '歌曲' };
  it.each([
    { result: { tracks: [track] } }, { playlist: { tracks: [track] } }, { result: { songs: [track] } },
    { toplist: { data: { songInfoList: [track] } } }, { req: { data: { body: { song: { list: [track] } } } } },
    { data: { songlist: [track] } }, { data: { song: { list: [track] } } }, { musiclist: [track] }, { abslist: [track] },
  ])('提取平台原始歌曲数组 %#', (input) => { expect(extractRawTracks(input)).toEqual([track]); });
  it('缺失或错误结构返回空数组', () => {
    for (const input of [null, {}, { data: false }]) { expect(extractRawTracks(input)).toEqual([]); expect(extractList(input)).toEqual([]); }
  });
  it.each([
    { data: { groupList: [{ toplist: [track] }] } }, { data: { group: [{ topList: [track] }] } },
    { groupList: [{ list: [track] }, { groupName: '空' }] }, { group: [{ toplist: [track] }] },
    { toplist: { data: { songInfoList: [track] } } }, { req: { data: { body: { song: { list: [track] } } } } },
    { tracks: [track] }, { data: [{ list: [track] }] }, { data: { hotSongs: [track] } }, track,
  ])('列表提取兼容分组、嵌套及单曲 %#', (input) => { expect(extractList(input)).toEqual([track]); });
  it('支持直接数组和按字段提供的分组列表', () => {
    for (const input of [[track], [{ toplist: [track] }], { results: [{ list: [track] }] }]) {
      expect(extractList(input as unknown as Record<string, unknown>)).toEqual([track]);
    }
  });
  it('平台标识及封面按字段优先级选择', () => {
    expect(findId({ topId: 42 }, 'qq')).toBe('42'); expect(findId({ id: 3 }, 'qq')).toBe('3'); expect(findId({}, 'qq')).toBeUndefined();
    expect(findId({ ID: 5 }, 'kuwo')).toBe('5'); expect(findImage({ mac_detail: { pic_v12: 'cover' } })).toBe('cover');
    expect(findImage({ mac_detail: { pic_v12: 12 } })).toBe('');
    const songs = normalizeSongs([
      { id: 1, singerList: [{ name: '歌手' }, null], album: { name: '专辑', picUrl: '//example.test/a.jpg' } },
      { id: 2, artist_name: '另一歌手', albumname: '专辑二' }, { id: 3, albumName: '专辑三' },
    ], 'qq');
    expect(songs[0]).toMatchObject({ artist: '歌手', album: '专辑', pic: 'https://example.test/a.jpg' });
    expect(songs[1]).toMatchObject({ artist: '另一歌手', album: '专辑二' }); expect(songs[2].album).toBe('专辑三');
  });
});

describe('findId', () => {
  it('should find QQ songmid first', () => {
    expect(findId({ songmid: 'abc123', id: 999 }, 'qq')).toBe('abc123');
  });

  it('should find QQ mid as fallback', () => {
    expect(findId({ mid: 'mid123' }, 'qq')).toBe('mid123');
  });

  it('should find QQ file.media_mid as fallback', () => {
    expect(findId({ file: { media_mid: 'fm123' } }, 'qq')).toBe('fm123');
  });

  it('should find kuwo rid first', () => {
    expect(findId({ rid: 12345, id: 999 }, 'kuwo')).toBe('12345');
  });

  it('should find kuwo musicrid as fallback', () => {
    expect(findId({ musicrid: 'music_123' }, 'kuwo')).toBe('music_123');
  });

  it('should fall back to item.id for generic platforms', () => {
    expect(findId({ id: 12345 }, 'netease')).toBe('12345');
  });

  it('should return undefined for null/undefined item', () => {
    expect(findId(null, 'qq')).toBeUndefined();
    expect(findId(undefined as any, 'qq')).toBeUndefined();
  });
});

describe('findImage', () => {
  it('should find picUrl first', () => {
    expect(findImage({ picUrl: 'https://example.com/pic.jpg' })).toBe('https://example.com/pic.jpg');
  });

  it('should find coverImgUrl as fallback', () => {
    expect(findImage({ coverImgUrl: 'https://example.com/cover.jpg' })).toBe('https://example.com/cover.jpg');
  });

  it('should find pic as fallback', () => {
    expect(findImage({ pic: 'https://example.com/p.jpg' })).toBe('https://example.com/p.jpg');
  });

  it('should return empty string for null/undefined', () => {
    expect(findImage(null)).toBe('');
    expect(findImage(undefined as any)).toBe('');
  });

  it('should return empty string when no image field found', () => {
    expect(findImage({ name: 'song', id: 1 })).toBe('');
  });
});

describe('normalizeSongs', () => {
  it('should normalize basic netease song objects', () => {
    const list = [
      {
        id: 123,
        name: 'Test Song',
        ar: [{ name: 'Artist1' }, { name: 'Artist2' }],
        al: { name: 'Test Album', picUrl: 'https://p1.music.126.net/cover.jpg' },
        album: 'Test Album',
      },
    ];
    const result = normalizeSongs(list, 'netease');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('123');
    expect(result[0].name).toBe('Test Song');
    expect(result[0].artist).toBe('Artist1/Artist2');
    expect(result[0].album).toBe('Test Album');
    expect(result[0].pic).toBe('https://p1.music.126.net/cover.jpg');
    expect(result[0].source).toBe('netease');
    expect((result[0] as any).isValidId).toBe(true);
  });

  it('should normalize QQ song objects with albummid cover construction', () => {
    const list = [
      {
        songmid: 'qq123',
        name: 'QQ Song',
        singer: [{ name: 'QQ Artist' }],
        albummid: 'album123',
      },
    ];
    const result = normalizeSongs(list, 'qq');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('qq123');
    expect(result[0].name).toBe('QQ Song');
    expect(result[0].artist).toBe('QQ Artist');
    expect(result[0].pic).toContain('500x500');
    expect(result[0].pic).toContain('album123');
  });

  it('should normalize kuwo song objects', () => {
    const list = [
      {
        rid: 456,
        name: 'Kuwo Song',
        artist: 'Kuwo Artist',
        album: 'Kuwo Album',
        pic: 'http://img1.kuwo.cn/cover.jpg',
      },
    ];
    const result = normalizeSongs(list, 'kuwo');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('456');
    expect(result[0].name).toBe('Kuwo Song');
    expect(result[0].artist).toBe('Kuwo Artist');
    expect(result[0].source).toBe('kuwo');
  });

  it('should handle missing artist fields with fallbacks', () => {
    const list = [
      {
        id: 1,
        name: 'Song',
        artists: [{ name: 'Artist A' }],
        album_name: 'Album',
      },
    ];
    const result = normalizeSongs(list, 'netease');
    expect(result[0].artist).toBe('Artist A');
    expect(result[0].album).toBe('Album');
  });

  it('should use Unknown Song/Artist for missing fields', () => {
    const list = [{ id: 1 }];
    const result = normalizeSongs(list, 'netease');
    expect(result[0].name).toBe('Unknown Song');
    expect(result[0].artist).toBe('Unknown Artist');
    expect(result[0].album).toBe('');
  });

  it('should generate temp_ ID when no valid ID found', () => {
    const list = [{ name: 'No ID Song' }];
    const result = normalizeSongs(list, 'netease');
    expect(result[0].id).toMatch(/^temp_/);
    expect((result[0] as any).isValidId).toBe(false);
  });

  it('should unwrap QQ data wrapper', () => {
    const list = [
      {
        data: {
          songmid: 'wrapped123',
          name: 'Wrapped Song',
          singer: [{ name: 'Singer' }],
        },
      },
    ];
    const result = normalizeSongs(list, 'qq');
    expect(result[0].id).toBe('wrapped123');
    expect(result[0].name).toBe('Wrapped Song');
  });

  it('should return empty array for non-array input', () => {
    expect(normalizeSongs(null as any, 'netease')).toEqual([]);
    expect(normalizeSongs(undefined as any, 'netease')).toEqual([]);
  });

  it('should filter out null/undefined items', () => {
    const list: any[] = [null, { id: 1, name: 'Valid' }, undefined, { id: 2, name: 'Also Valid' }];
    const result = normalizeSongs(list, 'netease');
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('Valid');
    expect(result[1].name).toBe('Also Valid');
  });
});
