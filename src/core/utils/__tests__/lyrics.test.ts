import { describe, it, expect } from 'vitest';
import {
  parseLyrics,
  mergeLyricTracks,
  findActiveLyricIndex,
  normalizeLyrics,
  hasTranslatedLyrics,
  hasExtendedLyrics,
  type LyricTrackBundle,
} from '../lyrics';

describe('parseLyrics', () => {
  it('should parse standard LRC format with timestamps', () => {
    const lrc = `
[00:01.00]First line
[00:03.50]Second line
[00:06.00]Third line
[00:10.00]Fourth line
`;
    const result = parseLyrics(lrc);
    expect(result).toHaveLength(4);
    expect(result[0].time).toBe(1);
    expect(result[0].text).toBe('First line');
    expect(result[1].time).toBe(3.5);
    expect(result[1].text).toBe('Second line');
    expect(result[2].time).toBe(6);
    expect(result[3].time).toBe(10);
  });

  it('should parse multiple timestamps on the same line', () => {
    const lrc = `[00:01.00][00:05.00]Repeated line`;
    const result = parseLyrics(lrc);
    expect(result).toHaveLength(2);
    expect(result[0].time).toBe(1);
    expect(result[0].text).toBe('Repeated line');
    expect(result[1].time).toBe(5);
    expect(result[1].text).toBe('Repeated line');
  });

  it('should skip metadata tags (ar, al, ti, by, length)', () => {
    const lrc = `
[ar:Artist Name]
[al:Album Name]
[ti:Song Title]
[by:Lyricist]
[length:03:30]
[00:01.00]Actual lyric
`;
    const result = parseLyrics(lrc);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Actual lyric');
  });

  it('should parse multi-track lyrics with translation markers', () => {
    const lrc = `[tunefree:main]
[00:01.00]Hello
[00:02.00]World

[tunefree:translation]
[00:01.00]你好
[00:02.00]世界`;
    const result = parseLyrics(lrc);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text).toBe('Hello');
    expect(result[0].translation).toBe('你好');
    expect(result[1].text).toBe('World');
    expect(result[1].translation).toBe('世界');
  });

  it('should parse multi-track lyrics with romanization markers', () => {
    const lrc = `[tunefree:main]
[00:01.00]歌词
[00:02.00]音乐

[tunefree:romanization]
[00:01.00]ge ci
[00:02.00]yin yue`;
    const result = parseLyrics(lrc);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].text).toBe('歌词');
    expect(result[0].romanization).toBe('ge ci');
    expect(result[1].text).toBe('音乐');
    expect(result[1].romanization).toBe('yin yue');
  });

  it('should handle lyrics without timestamps (plain text)', () => {
    const lrc = `Line one
Line two
Line three`;
    const result = parseLyrics(lrc);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe('Line one');
    expect(result[1].text).toBe('Line two');
    expect(result[2].text).toBe('Line three');
    // Plain rows get auto-generated times (index * 4)
    expect(result[0].time).toBe(0);
    expect(result[1].time).toBe(4);
    expect(result[2].time).toBe(8);
  });

  it('should handle empty or undefined input', () => {
    expect(parseLyrics(undefined)).toEqual([]);
    expect(parseLyrics('')).toEqual([]);
    expect(parseLyrics('   ')).toEqual([]);
  });

  it('should handle LRC with centisecond fractions', () => {
    const lrc = `[00:01.50]Half second
[00:02.00]Full second`;
    const result = parseLyrics(lrc);
    expect(result[0].time).toBe(1.5);
    expect(result[1].time).toBe(2);
  });

  it('should handle LRC with millisecond fractions', () => {
    const lrc = `[00:01.125]Millisecond`;
    const result = parseLyrics(lrc);
    expect(result[0].time).toBeCloseTo(1.125, 3);
  });

  it('should handle [offset] tag', () => {
    const lrc = `[offset:1000]
[00:01.00]Shifted line`;
    const result = parseLyrics(lrc);
    // offset is in milliseconds, positive offset shifts times forward
    expect(result[0].time).toBe(1 + 1);
  });

  it('should handle inline word time tags', () => {
    const lrc = `[00:01.00]<00:01.00>Word1 <00:01.50>Word2`;
    const result = parseLyrics(lrc);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('Word1 Word2');
    expect(result[0].words).toEqual([
      { start: 1, duration: 0.5, text: 'Word1 ' },
    ]);
  });

  it('should parse real karaoke duration words from GD Music karaoke track', () => {
    const lrc = `[tunefree:main]
[00:01.00]你好啊

[tunefree:karaoke]
[1000,1800](1000,500,0)你(1500,600,0)好(2100,700,0)啊`;
    const result = parseLyrics(lrc);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('你好啊');
    expect(result[0].extra).toBeUndefined();
    expect(result[0].words).toEqual([
      { start: 1, duration: 0.5, text: '你' },
      { start: 1.5, duration: 0.6, text: '好' },
      { start: 2.1, duration: 0.7, text: '啊' },
    ]);
  });

  it('should attach karaoke words when qrc line timing is close but not exact', () => {
    const lrc = `[tunefree:main]
[00:10.35]五月南风正和煦

[tunefree:karaoke]
[10100,2200](10100,300,0)五(10400,260,0)月(10660,280,0)南(10940,260,0)风(11200,300,0)正(11500,320,0)和(11820,300,0)煦`;
    const result = parseLyrics(lrc);
    expect(result[0].text).toBe('五月南风正和煦');
    expect(result[0].words).toHaveLength(7);
    expect(result[0].words?.[0]).toEqual({ start: 10.1, duration: 0.3, text: '五' });
  });

  it('should parse QQ QRC words with timing after each character', () => {
    const lrc = `[tunefree:main]
[00:21.44]那天偶然走进你

[tunefree:karaoke]
[21444,3697]那(21444,600)天(22044,500)偶(22544,520)然(23064,500)走(23564,520)进(24084,500)你(24584,557)`;
    const result = parseLyrics(lrc);
    expect(result[0].text).toBe('那天偶然走进你');
    expect(result[0].words).toEqual([
      { start: 21.444, duration: 0.6, text: '那' },
      { start: 22.044, duration: 0.5, text: '天' },
      { start: 22.544, duration: 0.52, text: '偶' },
      { start: 23.064, duration: 0.5, text: '然' },
      { start: 23.564, duration: 0.52, text: '走' },
      { start: 24.084, duration: 0.5, text: '进' },
      { start: 24.584, duration: 0.557, text: '你' },
    ]);
  });

  it('should activate karaoke line at the first word time when Netease YRC starts earlier than LRC', () => {
    const lrc = `[tunefree:main]
[00:15.73]这个失眠夜 想不起你是谁

[tunefree:karaoke]
[15010,4470](15010,330,0)这(15340,210,0)个(15550,310,0)失(15860,450,0)眠(16310,810,0)夜 (17120,360,0)想(17480,100,0)不(17580,530,0)起(18110,250,0)你(18360,280,0)是(18640,840,0)谁`;
    const result = parseLyrics(lrc);
    expect(result[0].text).toBe('这个失眠夜 想不起你是谁');
    expect(result[0].time).toBeCloseTo(15.01, 3);
    expect(result[0].words).toHaveLength(11);
  });
});

describe('mergeLyricTracks', () => {
  it('should merge main and translation tracks with markers', () => {
    const bundle: LyricTrackBundle = {
      main: '[00:01.00]Hello\n[00:02.00]World',
      translation: '[00:01.00]你好\n[00:02.00]世界',
    };
    const result = mergeLyricTracks(bundle);
    expect(result).toContain('[tunefree:main]');
    expect(result).toContain('[tunefree:translation]');
    expect(result).toContain('Hello');
    expect(result).toContain('你好');
  });

  it('should return main only if no other tracks', () => {
    const bundle: LyricTrackBundle = {
      main: '[00:01.00]Only main',
    };
    const result = mergeLyricTracks(bundle);
    expect(result).toBe('[00:01.00]Only main');
  });

  it('should return empty string if all tracks are empty', () => {
    const bundle: LyricTrackBundle = {};
    const result = mergeLyricTracks(bundle);
    expect(result).toBe('');
  });

  it('should handle undefined track values', () => {
    const bundle: LyricTrackBundle = {
      main: '[00:01.00]Text',
      translation: undefined,
      romanization: '   ',
    };
    const result = mergeLyricTracks(bundle);
    expect(result).toBe('[00:01.00]Text');
  });

  it('should merge all non-empty tracks', () => {
    const bundle: LyricTrackBundle = {
      main: '[00:01.00]主歌词',
      translation: '[00:01.00]翻译',
      romanization: '[00:01.00]roma',
    };
    const result = mergeLyricTracks(bundle);
    expect(result).toContain('[tunefree:main]');
    expect(result).toContain('[tunefree:translation]');
    expect(result).toContain('[tunefree:romanization]');
  });
});

describe('findActiveLyricIndex', () => {
  const rows = parseLyrics(`
[00:01.00]Line 1
[00:03.00]Line 2
[00:05.00]Line 3
[00:07.00]Line 4
[00:10.00]Line 5
`);

  it('should find the correct active line at a given time', () => {
    expect(findActiveLyricIndex(rows, 1)).toBe(0);
    expect(findActiveLyricIndex(rows, 2)).toBe(0);
    expect(findActiveLyricIndex(rows, 3)).toBe(1);
    expect(findActiveLyricIndex(rows, 5)).toBe(2);
    expect(findActiveLyricIndex(rows, 7)).toBe(3);
    expect(findActiveLyricIndex(rows, 10)).toBe(4);
  });

  it('should return 0 for time before first lyric', () => {
    expect(findActiveLyricIndex(rows, 0)).toBe(0);
    expect(findActiveLyricIndex(rows, 0.5)).toBe(0);
  });

  it('should return last index for time after last lyric', () => {
    expect(findActiveLyricIndex(rows, 15)).toBe(4);
    expect(findActiveLyricIndex(rows, 100)).toBe(4);
  });

  it('should return -1 for empty rows', () => {
    expect(findActiveLyricIndex([], 5)).toBe(-1);
  });

  it('should handle lyric offset', () => {
    // With offset of -1, a time of 2 should match line at time 1
    expect(findActiveLyricIndex(rows, 2, -1)).toBe(0);
    // With offset of +2, a time of 1 should match line at time 3
    expect(findActiveLyricIndex(rows, 1, 2)).toBe(1);
  });

  it('should handle exact boundary times with tolerance', () => {
    // At exactly 3.0, should point to line 2 (time=3)
    expect(findActiveLyricIndex(rows, 3.0)).toBe(1);
    // At 2.99, should still point to line 1 (time=1)
    expect(findActiveLyricIndex(rows, 2.99)).toBe(0);
    // At 3.01, should point to line 2 (time=3)
    expect(findActiveLyricIndex(rows, 3.01)).toBe(1);
  });
});

describe('normalizeLyrics', () => {
  it('should normalize a bundle with main and translation tracks', () => {
    const bundle: LyricTrackBundle = {
      main: '[00:01.00]Hello\n[00:02.00]World',
      translation: '[00:01.00]你好\n[00:02.00]世界',
      source: 'netease',
    };
    const result = normalizeLyrics(bundle);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].text).toBe('Hello');
    expect(result.lines[0].translation).toBe('你好');
    expect(result.source).toBe('netease');
    expect(result.raw).toEqual(bundle);
  });

  it('should handle bundle with only main track', () => {
    const bundle: LyricTrackBundle = {
      main: '[00:01.00]Only main',
    };
    const result = normalizeLyrics(bundle);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0].text).toBe('Only main');
    expect(result.lines[0].translation).toBeUndefined();
  });

  it('should handle empty bundle', () => {
    const result = normalizeLyrics({});
    expect(result.lines).toHaveLength(0);
  });
});

describe('hasTranslatedLyrics', () => {
  it('should return true when translation exists', () => {
    const rows = parseLyrics(`[tunefree:main]
[00:01.00]Hello

[tunefree:translation]
[00:01.00]你好`);
    expect(hasTranslatedLyrics(rows)).toBe(true);
  });

  it('should return false when no translation exists', () => {
    const rows = parseLyrics('[00:01.00]Hello');
    expect(hasTranslatedLyrics(rows)).toBe(false);
  });
});

describe('hasExtendedLyrics', () => {
  it('should return true when romanization exists', () => {
    const rows = parseLyrics(`[tunefree:main]
[00:01.00]歌词

[tunefree:romanization]
[00:01.00]ge ci`);
    expect(hasExtendedLyrics(rows)).toBe(true);
  });

  it('should return false when only main lyrics exist', () => {
    const rows = parseLyrics('[00:01.00]Hello');
    expect(hasExtendedLyrics(rows)).toBe(false);
  });
});
