import { describe, expect, it } from 'vitest';
import { getPlatformSongDuration, readSongDuration } from '../songDuration';

describe('平台录音时长单位', () => {
  it('按秒、毫秒或 mm:ss/hh:mm:ss读取，不将无效数据猜成时长', () => {
    expect(readSongDuration(123.5)).toBe(123.5);
    expect(readSongDuration('123500', true)).toBe(123.5);
    expect(readSongDuration('02:03.5')).toBe(123.5);
    expect(readSongDuration('1:02:03')).toBe(3723);
    for (const value of [undefined, null, {}, -1, 0, NaN, Infinity, '', 'bad', '2:60', 'a:03', '1:2:3:4']) {
      expect(readSongDuration(value)).toBeUndefined();
    }
  });
  it('保留标准时长，网易以毫秒、QQ interval、酷我 song_duration以秒', () => {
    expect(getPlatformSongDuration({ durationSeconds: 123.5, dt: 500 }, 'netease')).toBe(123.5);
    expect(getPlatformSongDuration({ dt: 123500 }, 'netease')).toBe(123.5);
    expect(getPlatformSongDuration({ duration: 123500 }, 'netease')).toBe(123.5);
    expect(getPlatformSongDuration({ interval: 123.5 }, 'qq')).toBe(123.5);
    expect(getPlatformSongDuration({ song_duration: '123', duration: '1' }, 'kuwo')).toBe(123);
    expect(getPlatformSongDuration({ DURATION: '123' }, 'kuwo')).toBe(123);
    expect(getPlatformSongDuration({ songTimeMinutes: '02:03' }, 'kuwo')).toBe(123);
    expect(getPlatformSongDuration({ duration: '1' }, 'kuwo')).toBeUndefined();
    expect(getPlatformSongDuration({ duration: 123 }, 'joox')).toBeUndefined();
    expect(getPlatformSongDuration({}, 'netease')).toBeUndefined();
  });
});
