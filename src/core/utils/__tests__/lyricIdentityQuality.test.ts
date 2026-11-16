import { describe, expect, it } from 'vitest';
import { parseLyrics, mergeLyricTracks } from '../lyrics';
import { matchesLyricDuration, matchesLyricSongIdentity, sameLyricAlbum } from '../lyrics/identity';
import { hasRealTimedWords, isLyricImprovement, isUsableSyncedLyric, lyricsHaveSameText } from '../lyrics/quality';

const plain = '[00:01]你好\n[00:03]世界';
const words = '[1000,1000](1000,500,0)你(1500,500,0)好\n[3000,1000](3000,500,0)世(3500,500,0)界';
const identity = { name: '你好', artist: '甲, 乙', album: '专辑', durationSeconds: 120 };

describe('跨平台录音身份核对', () => {
  it('只归一宽度、标点与空白，完整演出/混音名称和所有歌手必须一致', () => {
    expect(matchesLyricSongIdentity({ name: '你 好！', artist: '乙 / 甲' }, identity)).toBe(true);
    expect(matchesLyricSongIdentity({ name: '你好', artist: '甲 feat. 乙' }, identity)).toBe(true);
    expect(matchesLyricSongIdentity({ name: '你好', artist: '甲 & 甲, 乙' }, identity)).toBe(true);
    for (const candidate of [
      { name: '你好呀', artist: identity.artist }, { name: '你好', artist: '甲' },
      { name: '你好', artist: '甲, 丙' }, { name: '你好', artist: '甲, 乙, 丙' },
      { name: '你好 (Live)', artist: identity.artist },
    ]) expect(matchesLyricSongIdentity(candidate, identity)).toBe(false);
    for (const version of ['Live', 'Remix', 'Acoustic', 'Instrumental', 'Demo', 'Cover', 'Sped Up', 'Slowed', 'Radio Edit', 'Remastered']) {
      expect(matchesLyricSongIdentity({ ...identity, name: `你好 (${version})` }, identity)).toBe(false);
    }
    expect(matchesLyricSongIdentity({ ...identity, name: '你好 (Live 2024 Tokyo)' },
      { ...identity, name: '你好 (Live 2025 Beijing)' })).toBe(false);
    expect(matchesLyricSongIdentity({ ...identity, name: '你好（Artist A Remix）' },
      { ...identity, name: '你好 (Artist B Remix)' })).toBe(false);
    expect(matchesLyricSongIdentity({ ...identity, name: '你好（Live 2024）' },
      { ...identity, name: '你好 [Live 2024]' })).toBe(true);
  });

  it('缺少真实身份时不能选歌词；仅播放解析可省略目标歌手', () => {
    for (const candidate of [{}, { name: 'Unknown Song' }, { name: '未知歌曲' }, { name: '' }]) {
      expect(matchesLyricSongIdentity(candidate, identity)).toBe(false);
      expect(matchesLyricSongIdentity(identity, candidate)).toBe(false);
    }
    expect(matchesLyricSongIdentity(identity, { name: '你好' })).toBe(false);
    expect(matchesLyricSongIdentity(identity, { name: '你好', artist: 'Unknown Artist' }, false)).toBe(true);
    expect(matchesLyricSongIdentity({ name: '!!!', artist: '甲' }, { name: '!!!', artist: '甲' })).toBe(false);
    for (const artist of [undefined, '', 'Unknown Artist', '未知歌手']) {
      expect(matchesLyricSongIdentity({ name: '你好', artist }, identity)).toBe(false);
    }
  });

  it('只允许两秒内的已知正时长，专辑只能作排序依据', () => {
    expect(matchesLyricDuration(122, 120)).toBe(true);
    expect(matchesLyricDuration(117.99, 120)).toBe(false);
    for (const value of [undefined, NaN, Infinity, 0, -1]) {
      expect(matchesLyricDuration(value, 120)).toBe(false);
      expect(matchesLyricDuration(120, value)).toBe(false);
    }
    expect(sameLyricAlbum('专 辑！', '专辑')).toBe(true);
    expect(sameLyricAlbum('专辑', '精选')).toBe(false);
    expect(sameLyricAlbum(undefined, '')).toBe(false);
  });
});

describe('真实时间轴质量与安全降级', () => {
  it('逐字必须有真实正时长，零时长标记和纯文本不算逐字数据', () => {
    expect(hasRealTimedWords(parseLyrics(words))).toBe(true);
    expect(hasRealTimedWords(parseLyrics(plain))).toBe(false);
    expect(hasRealTimedWords([{ time: 0, text: '字', words: [
      { start: -1, duration: 1, text: '字' }, { start: 0, duration: 0, text: '字' },
      { start: 0, duration: Infinity, text: '字' }, { start: NaN, duration: 1, text: '字' },
      { start: 1, duration: 1, text: ' ' },
    ] }])).toBe(false);
    expect(isUsableSyncedLyric(plain, 120)).toBe(true);
    expect(isUsableSyncedLyric('没有时间\n逐行静态', 120)).toBe(false);
    expect(isUsableSyncedLyric(undefined, 120)).toBe(false);
  });

  it('同歌词逐字、译文和罗马音会改善，错歌词或退化会被拒绝', () => {
    const translated = mergeLyricTracks({ main: plain, translation: '[00:01]Hello\n[00:03]World' });
    const romanized = mergeLyricTracks({ main: plain, romanization: '[00:01]ni hao\n[00:03]shi jie' });
    expect(isLyricImprovement(plain, words, 120)).toBe(true);
    expect(isLyricImprovement(plain, translated, 120)).toBe(true);
    expect(isLyricImprovement(plain, romanized, 120)).toBe(true);
    expect(isLyricImprovement(words, plain, 120)).toBe(false);
    expect(isLyricImprovement(translated, romanized, 120)).toBe(false);
    expect(isLyricImprovement(plain, plain, 120)).toBe(false);
    expect(isLyricImprovement(plain, '[1000,500](1000,500,0)另一首', 120)).toBe(false);
    expect(isLyricImprovement('接口维护中', plain, 120)).toBe(true);
    expect(isLyricImprovement(undefined, plain, 120)).toBe(true);
    expect(isLyricImprovement(plain, undefined, 120)).toBe(false);
    expect(isLyricImprovement(plain, '  ', 120)).toBe(false);
    expect(isLyricImprovement(plain, '[ar:歌手]', 120)).toBe(false);
  });

  it('大幅超出媒体尾部的行/词不能替换已有可用轨，错版本可用有效新轨纠正', () => {
    const overrun = '[02:25]旧版一\n[02:40]旧版二';
    expect(isUsableSyncedLyric(overrun, 120)).toBe(false);
    expect(isLyricImprovement(plain, overrun, 120)).toBe(false);
    expect(isLyricImprovement(overrun, plain, 120)).toBe(true);
    expect(isUsableSyncedLyric('[1000,150000](1000,150000,0)你好', 120)).toBe(false);
  });

  it('比较整首文本容忍分行，但不能由一个相同词替换整首歌词', () => {
    expect(lyricsHaveSameText(parseLyrics(plain), parseLyrics('[00:01]你好世界'))).toBe(true);
    expect(lyricsHaveSameText(parseLyrics('[00:01]hello'), parseLyrics('[00:01]hello\n[00:03]other\n[00:04]song'))).toBe(false);
    expect(lyricsHaveSameText([], parseLyrics(plain))).toBe(false);
  });
});
