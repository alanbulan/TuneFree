import { describe, expect, it } from 'vitest';
import { normalizeLyrics, parseLyrics, mergeTranslatedLyrics, toLegacyParsedLyrics } from '../lyrics';
import { buildRowsFromPrimaryAndTracks } from '../lyrics/trackMatcher';
import { parseLyricDocument, parseTrackLines } from '../lyrics/documentParser';
describe('扩展歌词轨的对齐与旧格式', () => {
  it('统一过滤扩展轨的空翻译占位符，保留正常歌词中的斜线', () => {
    const { lines } = normalizeLyrics({
      main: '[00:01]AC/DC\n[00:05]第二句',
      translation: '[00:01] // \n[00:05]and/or',
      romanization: '[00:01]//\n[00:05]di er ju',
      pronunciation: '[00:01]//',
    });
    expect(lines[0]).toMatchObject({ time: 1, text: 'AC/DC' });
    expect(lines[0].translation).toBeUndefined();
    expect(lines[0].romanization).toBeUndefined();
    expect(lines[0].pronunciation).toBeUndefined();
    expect(lines[1]).toMatchObject({ translation: 'and/or', romanization: 'di er ju' });
  });
  it('旧格式中的占位符仍参与轨道分段，不把后续翻译当成主歌词', () => {
    const lines = parseLyrics('[00:01]第一句\n[00:05]第二句\n[00:01]//\n[00:05]第二句的翻译');
    expect(lines).toHaveLength(2);
    expect(lines[0].translation).toBeUndefined();
    expect(lines[1]).toMatchObject({ text: '第二句', translation: '第二句的翻译' });
  });
  it('毫秒行内逐字时长及倒序时标分段均被保留', () => {
    expect(parseLyrics('[00:01]<1000,500>你<1500,500>好')[0].words).toEqual([
      { start: 1, duration: 0.5, text: '你' }, { start: 1.5, duration: 0.5, text: '好' },
    ]);
    const document = parseLyricDocument('[10000,1000]第一段\n[1000,1000]第二段');
    expect(document.blocks).toHaveLength(2);
    expect(document.blocks[1].lines[0]).toMatchObject({ time: 1, text: '第二段' });
  });
  it('近似时间匹配只使用容差内的扩展行，发音轨去重合并', () => {
    const rows = buildRowsFromPrimaryAndTracks(parseTrackLines('[00:01]主词\n[00:04]第二句', 'main'), [
      { type: 'translation', lines: parseTrackLines('[00:01.05]translation\n[00:10]过远的行', 'translation'), toleranceSeconds: 0.1 },
      { type: 'pronunciation', lines: parseTrackLines('[00:01]注音\n[00:04]字音', 'pronunciation'), toleranceSeconds: 0.1 },
      { type: 'pronunciation', lines: parseTrackLines('[00:01]注音\n[00:01]另一读音', 'pronunciation'), toleranceSeconds: 0.1 },
    ]);
    expect(rows[0]).toMatchObject({ translation: 'translation', pronunciation: '注音\n另一读音' }); expect(rows[1].translation).toBeUndefined();
  });
  it('旧版连续倒序段识别翻译和罗马音，归一化接口保留行数据', () => {
    const rows = parseLyrics('[00:01]主词\n[00:04]第二句\n[00:01]翻译一\n[00:04]翻译二\n[00:01]另一翻译一\n[00:04]另一翻译二\n[00:01]roma\n[00:04]roma two');
    expect(rows[0]).toMatchObject({ translation: '翻译一\n另一翻译一', romanization: 'roma' });
    const normalized = normalizeLyrics({ main: '[00:01]词', pronunciation: '[00:01]ci' });
    expect(toLegacyParsedLyrics(normalized)).toBe(normalized.lines);
    expect(parseLyrics(mergeTranslatedLyrics('[00:01]词', '[00:01]word'))[0].translation).toBe('word');
  });
  it('标记只接受实际轨道名，损坏的逐字时标不会破坏后续歌词', () => {
    expect(parseLyricDocument('[constructor]\n[00:01]正常歌词').blocks[0].type).toBe('auto');
    expect(parseLyrics('[00:01]<100>错误<00:02.0>后续<00:03.0>歌词')[0].text).toContain('后续');
    expect(parseLyrics('[1000,1000]前缀(1000,500)(1500,500)尾巴\n[1000,1000](1000,500,0)新句')).toHaveLength(1);
  });
});
