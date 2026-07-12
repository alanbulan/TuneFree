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

  it('should remove only known third-party watermarks at the 999-minute sentinel', () => {
    const lrc = `[999:00.00]***歌詞來自第三方***
[999:01.23]***歌词来自第三方***
[998:59.99]***歌詞來自第三方***
[999:02.00]第三方歌词说明`;

    expect(parseLyrics(lrc).map(({ time, text }) => ({ time, text }))).toEqual([
      { time: 59939.99, text: '***歌詞來自第三方***' },
      { time: 59942, text: '第三方歌词说明' },
    ]);
    expect(parseLyrics('[123:45.67]***歌詞來自第三方***')[0]).toMatchObject({
      time: 7425.67,
      text: '***歌詞來自第三方***',
    });
  });

  it('should preserve a normal timestamp paired with a 999-minute watermark timestamp', () => {
    const result = parseLyrics('[999:00.00][00:05.00]***歌詞來自第三方***');

    expect(result.map(({ time, text }) => ({ time, text }))).toEqual([
      { time: 5, text: '***歌詞來自第三方***' },
    ]);
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

  it('should preserve real word timing from a translation track', () => {
    const lrc = `[tunefree:main]
[00:01.00]君と出会えた

[tunefree:translation]
[1000,1800](1000,500,0)与(1500,600,0)你(2100,700,0)相遇`;
    const result = parseLyrics(lrc);
    expect(result[0].translation).toBe('与你相遇');
    expect(result[0].translationWords).toEqual([
      { start: 1, duration: 0.5, text: '与' },
      { start: 1.5, duration: 0.6, text: '你' },
      { start: 2.1, duration: 0.7, text: '相遇' },
    ]);
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
    expect(result[0].time).toBeCloseTo(15.73, 3);
    expect(result[0].karaokeTime).toBeCloseTo(15.01, 3);
    expect(result[0].words).toHaveLength(11);
    expect(findActiveLyricIndex(result, 15.2, 0, 'line')).toBe(-1);
    expect(findActiveLyricIndex(result, 15.2, 0, 'karaoke')).toBe(0);
  });

  it('should attach all Netease YRC rows when matching text drifts several seconds', () => {
    const lrc = `[tunefree:main]
[02:18.54]呜呜呜呜…
[02:23.35]快来抱抱 快来抱抱我
[02:31.68]呜呜呜呜…

[tunefree:karaoke]
[137160,2500](137160,500,0)呜(137660,500,0)呜(138160,500,0)呜(138660,500,0)呜(139160,500,0)…
[140130,4200](140130,300,0)快(140430,300,0)来(140730,500,0)抱(141230,500,0)抱 (141730,300,0)快(142030,300,0)来(142330,500,0)抱(142830,500,0)抱(143330,1000,0)我
[145470,2500](145470,500,0)呜(145970,500,0)呜(146470,500,0)呜(146970,500,0)呜(147470,500,0)…`;
    const result = parseLyrics(lrc);

    expect(result).toHaveLength(3);
    expect(result.every((row) => (row.words?.length || 0) > 1)).toBe(true);
    expect(result[1].time).toBeCloseTo(143.35, 3);
    expect(result[1].karaokeTime).toBeCloseTo(140.13, 3);
    expect(findActiveLyricIndex(result, 141, 0, 'line')).toBe(0);
    expect(findActiveLyricIndex(result, 141, 0, 'karaoke')).toBe(1);
  });

  it('should match Netease YRC text case-insensitively', () => {
    const lrc = `[tunefree:main]
[00:19.38]我听着耳机中Jay的音乐

[tunefree:karaoke]
[19170,3440](19170,390,0)我(19560,450,0)听(20010,420,0)着(20430,320,0)耳(20750,200,0)机(20950,220,0)中(21170,220,0)jay(21390,360,0)的(21750,430,0)音(22180,430,0)乐`;
    const result = parseLyrics(lrc);

    expect(result[0].words).toHaveLength(10);
    expect(result[0].karaokeTime).toBeCloseTo(19.17, 3);
  });

  it('should split one merged YRC row across multiple LRC rows at word boundaries', () => {
    const lrc = `[tunefree:main]
[00:10.00]如果我们
[00:12.00]不曾相遇

[tunefree:karaoke]
[9500,5000](9500,500,0)如(10000,500,0)果(10500,500,0)我(11000,500,0)们(11500,500,0)不(12000,500,0)曾(12500,500,0)相(13000,500,0)遇`;
    const result = parseLyrics(lrc);

    expect(result[0].words?.map((word) => word.text).join('')).toBe('如果我们');
    expect(result[1].words?.map((word) => word.text).join('')).toBe('不曾相遇');
    expect(result[0].karaokeTime).toBe(9.5);
    expect(result[1].karaokeTime).toBe(11.5);
  });

  it('should merge multiple YRC rows into one LRC row', () => {
    const lrc = `[tunefree:main]
[00:20.00]突然好想你你会在哪里

[tunefree:karaoke]
[19500,2500](19500,500,0)突(20000,500,0)然(20500,500,0)好(21000,500,0)想(21500,500,0)你
[22000,2500](22000,500,0)你(22500,500,0)会(23000,500,0)在(23500,500,0)哪(24000,500,0)里`;
    const result = parseLyrics(lrc);

    expect(result[0].words?.map((word) => word.text).join('')).toBe('突然好想你你会在哪里');
    expect(result[0].words).toHaveLength(10);
    expect(result[0].karaokeTime).toBe(19.5);
  });

  it('should keep a line static when nearby YRC text is different', () => {
    const lrc = `[tunefree:main]
[00:22.47]琴键上透着光

[tunefree:karaoke]
[22520,2400](22520,400,0)装(22920,400,0)饰(23320,400,0)着(23720,400,0)教(24120,400,0)堂`;
    const result = parseLyrics(lrc);

    expect(result[0].words).toBeUndefined();
    expect(result[0].karaokeTime).toBeUndefined();
  });

  it('should tolerate one-character text variants inside the local time window', () => {
    const lrc = `[tunefree:main]
[00:30.00]有些人一旦错过就不在

[tunefree:karaoke]
[29400,4400](29400,400,0)有(29800,400,0)些(30200,400,0)人(30600,400,0)一(31000,400,0)旦(31400,400,0)错(31800,400,0)过(32200,400,0)就(32600,400,0)不(33000,400,0)再`;
    const result = parseLyrics(lrc);

    expect(result[0].words?.map((word) => word.text).join('')).toBe('有些人一旦错过就不再');
    expect(result[0].karaokeTime).toBe(29.4);
  });

  it('should match repeated chorus rows in their original order', () => {
    const lrc = `[tunefree:main]
[00:10.00]第一句
[00:14.00]第二句
[00:40.00]第一句
[00:44.00]第二句

[tunefree:karaoke]
[9800,1200](9800,400,0)第(10200,400,0)一(10600,400,0)句
[13800,1200](13800,400,0)第(14200,400,0)二(14600,400,0)句
[39800,1200](39800,400,0)第(40200,400,0)一(40600,400,0)句
[43800,1200](43800,400,0)第(44200,400,0)二(44600,400,0)句`;
    const result = parseLyrics(lrc);

    expect(result.map((row) => row.karaokeTime)).toEqual([9.8, 13.8, 39.8, 43.8]);
  });

  it('should retain zero-duration punctuation tokens', () => {
    const lrc = `[tunefree:main]
[00:01.00]你，好

[tunefree:karaoke]
[1000,800](1000,400,0)你(1400,0,0)，(1400,400,0)好`;
    const result = parseLyrics(lrc);

    expect(result[0].words).toEqual([
      { start: 1, duration: 0.4, text: '你' },
      { start: 1.4, duration: 0, text: '，' },
      { start: 1.4, duration: 0.4, text: '好' },
    ]);
  });

  it('should reject a distant karaoke credit line outside the verified singing drift', () => {
    const lrc = `[tunefree:main]
[00:30.00]同一句歌词

[tunefree:karaoke]
[15510,2000](15510,500,0)同(16010,500,0)一(16510,500,0)句(17010,500,0)歌(17510,500,0)词`;
    const result = parseLyrics(lrc);

    expect(result[0].karaokeTime).toBeUndefined();
    expect(result[0].words).toBeUndefined();
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

  it('should return -1 for time before first lyric', () => {
    expect(findActiveLyricIndex(rows, 0)).toBe(-1);
    expect(findActiveLyricIndex(rows, 0.5)).toBe(-1);
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
    expect(findActiveLyricIndex(rows, 0.5, -1)).toBe(-1);
  });

  it('should return -1 before the first karaoke word timing', () => {
    const karaokeRows = parseLyrics(`[tunefree:main]
[00:10.00]First line
[00:20.00]Second line

[tunefree:karaoke]
[9500,1000](9500,500,0)First(10000,500,0) line
[19500,1000](19500,500,0)Second(20000,500,0) line`);

    expect(findActiveLyricIndex(karaokeRows, 9.49, 0, 'karaoke')).toBe(-1);
    expect(findActiveLyricIndex(karaokeRows, 9.5, 0, 'karaoke')).toBe(0);
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
