import { describe, expect, it } from 'vitest';
import { parseLyrics, mergeLyricTracks } from '../lyrics';
import { parseLyricDocument } from '../lyrics/documentParser';

describe('真实逐字格式与 offset 坐标', () => {
  it('KRC 三元尖括号相对行起点，词偏移超过行起点仍使用同一坐标系', () => {
    const row = parseLyrics('[krc]\n[1000,4000]<0,1200,0>你<1200,1700,0>好<2900,1100,0>啊')[0];
    expect(row.text).toBe('你好啊');
    expect(row.words).toEqual([{ start: 1, duration: 1.2, text: '你' },
      { start: 2.2, duration: 1.7, text: '好' }, { start: 3.9, duration: 1.1, text: '啊' }]);
  });

  it('QRC 相对后置时标整行归一，YRC 绝对前置时间不重复加行起点', () => {
    expect(parseLyrics('[1000,4000]你(0,1200)好(1200,1700)啊(2900,1100)')[0].words?.map((word) => word.start))
      .toEqual([1, 2.2, 3.9]);
    expect(parseLyrics('[1000,4000](1000,1200,0)你(2200,1700,0)好(3900,1100,0)啊')[0].words?.map((word) => word.start))
      .toEqual([1, 2.2, 3.9]);
  });

  it('放在轨道末尾的 offset 同时移动行时标和词时标，各轨道 offset 相互独立', () => {
    const row = parseLyrics(mergeLyricTracks({ main: '[00:01]你好\n[offset:500]',
      karaoke: '[1000,1000](1000,500,0)你(1500,500,0)好\n[offset:500]' }))[0];
    expect(row.time).toBe(1.5); expect(row.karaokeTime).toBe(1.5);
    expect(row.words?.map((word) => word.start)).toEqual([1.5, 2]);
    const negative = parseLyrics('[offset:-2000]\n[1000,1000](1000,500,0)你(1500,500,0)好')[0];
    expect(negative.time).toBe(0); expect(negative.words?.map((word) => word.start)).toEqual([0, 0]);
    expect(negative.words?.map((word) => word.duration)).toEqual([0, 0]);
  });

  it('多时标的 Enhanced LRC 副歌复制时移动逐字时间，末词不丢失', () => {
    const rows = parseLyrics('[00:01][00:11]<00:01.0>你<00:01.5>好');
    expect(rows[0].words).toEqual([{ start: 1, duration: 0.5, text: '你' }, { start: 1.5, duration: 0, text: '好' }]);
    expect(rows[1].words?.map((word) => word.start)).toEqual([11, 11.5]);
  });

  it('QRC XML 仅提取 LyricContent，XML 和括号不进入演唱文字', () => {
    const rows = parseLyrics('<QrcInfos><LyricInfo LyricContent="[1000,1000]你(1000,500)好&amp;我(1500,500)&#10;[3000,500]Oh(3000,500)" /></QrcInfos>');
    expect(rows).toHaveLength(2); expect(rows[0].text).toBe('你好&我');
    expect(rows[1].words).toEqual([{ start: 3, duration: 0.5, text: 'Oh' }]);
  });

  it('Enhanced LRC 前缀和零时长标点保留文字，没有源时长时不伪造末词演唱速度', () => {
    const row = parseLyrics('[00:01]前缀<00:01.20>你<00:01.50>，<00:01.50>好')[0];
    expect(row.words?.map((word) => word.text).join('')).toBe('前缀你，好');
    expect(row.words?.slice(-1)[0]?.duration).toBe(0);
    expect(parseLyrics('纯文本\n没有时间').every((line) => line.untimed && !line.words)).toBe(true);
  });

  it('原生QRC/YRC词时间早于行起点仍使用绝对坐标，不能逐词猜相对', () => {
    expect(parseLyrics('[2000,1200](1800,500,0)你(2300,700,0)好')[0].words?.map((word) => word.start)).toEqual([1.8, 2.3]);
    expect(parseLyrics('[2000,1200]你(1800,500)好(2300,700)')[0].words?.map((word) => word.start)).toEqual([1.8, 2.3]);
  });

  it('负offset同时裁剪Enhanced词的起止时间，不能把已唱完的词移到0秒再唱', () => {
    const row = parseLyrics('[00:01]<00:01.00>你<00:01.5>好<00:02.00>\n[offset:-1500]')[0];
    expect(row.time).toBe(0);
    expect(row.words).toEqual([{ start: 0, duration: 0, text: '你' }, { start: 0, duration: 0.5, text: '好' }]);
  });

  it('Enhanced整秒的分:秒时标不能误读为秒的小数部分', () => {
    expect(parseLyrics('[01:02]<01:02>你<01:03>好<01:04>')[0].words).toEqual([
      { start: 62, duration: 1, text: '你' }, { start: 63, duration: 1, text: '好' },
    ]);
  });

  it('LRC行标签和YRC前置词标记混用时，行标签不能成为后置QRC的演唱文字', () => {
    expect(parseLyrics('[00:01](1000,500,0)你(1500,500,0)好')[0].words).toEqual([
      { start: 1, duration: 0.5, text: '你' }, { start: 1.5, duration: 0.5, text: '好' },
    ]);
    expect(parseLyrics('[00:01]你(1000,500)好(1500,500)')[0].words?.map((word) => word.text)).toEqual(['你', '好']);
  });

  it('marker前公共offset继承到各轨，轨内offset可覆盖而不影响其它轨', () => {
    const row = parseLyrics('[offset:500]\n[main]\n[00:01]你好\n[translation]\n[00:01]Hello\n[karaoke]\n[1000,1000](1000,500,0)你(1500,500,0)好')[0];
    expect(row.time).toBe(1.5); expect(row.translation).toBe('Hello');
    expect(row.words?.map((word) => word.start)).toEqual([1.5, 2]);
    const independent = '[offset:500]\n[main]\n[offset:1000]\n[00:01]主轨\n[translation]\n[00:01.5]译轨';
    expect(parseLyricDocument(independent).blocks.map((block) => block.lines[0].time)).toEqual([2, 2]);
    expect(parseLyrics(independent)[0].translation).toBe('译轨');
    const implicit = '[offset:500]\n[00:01]主轨\n[translation]\n[00:01.5]译轨';
    expect(parseLyricDocument(implicit).blocks.map((block) => block.lines[0].time)).toEqual([1.5, 1.5]);
    expect(parseLyrics(implicit)[0].translation).toBe('译轨');
  });
});
