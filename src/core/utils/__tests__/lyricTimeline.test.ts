import { describe, expect, it } from 'vitest';
import { analyzeLyricTimeline } from '../lyrics/timeline';

describe('analyzeLyricTimeline', () => {
  it('returns a stable unavailable structure without lyrics or media duration', () => {
    expect(analyzeLyricTimeline('', 0)).toEqual({
      status: 'unavailable',
      durationSeconds: 0,
      lastLineTimeSeconds: null,
      overrunSeconds: 0,
      outOfRangeLineCount: 0,
    });
  });

  it('reports the known short-audio/long-lyric version mismatch without changing media data', () => {
    const result = analyzeLyricTimeline([
      '[03:20.47]坚持梦想',
      '[03:23.29]不管前路迷茫',
      '[03:30.49]斑驳的相框',
      '[04:17.80]飞向未来的方向',
    ].join('\n'), 206.481247);

    expect(result).toMatchObject({
      status: 'overrun',
      durationSeconds: 206.481247,
      lastLineTimeSeconds: 257.8,
      outOfRangeLineCount: 2,
    });
    expect(result.overrunSeconds).toBeCloseTo(51.318753, 6);
  });

  it('does not classify a single slightly late line as a version mismatch', () => {
    expect(analyzeLyricTimeline('[03:20.00]最后一句\n[03:31.00]尾声', 200)).toMatchObject({
      status: 'ok',
      outOfRangeLineCount: 1,
    });
  });

  it('纯文本没有可验证时间轴，真实词结束明显越界则有直接不匹配证据', () => {
    expect(analyzeLyricTimeline('纯文本\n只有静态文字', 120)).toMatchObject({ status: 'unavailable', lastLineTimeSeconds: null });
    expect(analyzeLyricTimeline('[1000,150000](1000,150000,0)整行时间码异常', 120)).toMatchObject({ status: 'overrun', overrunSeconds: 31 });
    expect(analyzeLyricTimeline('[1000,1000](1000,1000,0)正常词', 120)).toMatchObject({ status: 'ok', overrunSeconds: 0 });
  });
});
