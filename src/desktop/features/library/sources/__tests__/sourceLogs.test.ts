import { describe, expect, it } from 'vitest';
import { parseSourceLogs, splitSourceLog, summarizeSourceLogs } from '../sourceLogs';

describe('音源运行日志解析', () => {
  it('拆出时间、标签与内容；缺哪段都能正常显示', () => {
    expect(splitSourceLog('[09:12:05] [调用失败] kw · musicUrl：上游 500'))
      .toEqual({ time: '09:12:05', tag: '调用失败', message: 'kw · musicUrl：上游 500' });
    // 沙箱写入的行一定带时间，但历史快照与脚本自输出可能没有
    expect(splitSourceLog('[调用失败] 上游 500'))
      .toEqual({ time: '', tag: '调用失败', message: '上游 500' });
    expect(splitSourceLog('就是一句普通输出'))
      .toEqual({ time: '', tag: '', message: '就是一句普通输出' });
    // 内容里还有方括号时不能被当作标签截断
    expect(splitSourceLog('[09:12:05] [log] [嵌套] 内容'))
      .toEqual({ time: '09:12:05', tag: 'log', message: '[嵌套] 内容' });
    // 时间必须是行首的 H:MM 或 HH:MM(:SS)，普通方括号内容不算时间
    expect(splitSourceLog('[备注] 内容')).toEqual({ time: '', tag: '备注', message: '内容' });
  });

  it('把同一次失败产生的多条重复日志归并计数并保留首次顺序', () => {
    const logs = [
      '[已加载] 声明平台：kw / local；尚未验证解析',
      '[请求失败] xxx：音源上游请求失败',
      '[log] 音源上游请求失败',
      '[调用失败] kw · musicUrl · 128k：音源上游请求失败',
      '[请求失败] xxx：音源上游请求失败',
      '[log] 音源上游请求失败',
      '[调用失败] kw · musicUrl · 128k：音源上游请求失败',
    ];

    const entries = parseSourceLogs(logs);

    // 7 行原始日志压成 4 类，顺序按首次出现
    expect(entries).toHaveLength(4);
    expect(entries.map((entry) => entry.count)).toEqual([1, 2, 2, 2]);
    expect(entries[0]).toMatchObject({ tag: '已加载', count: 1 });
    expect(entries[1]).toMatchObject({ tag: '请求失败', count: 2 });
  });

  it('同一内容配不同标签不会被误合并', () => {
    const entries = parseSourceLogs(['[请求失败] 上游失败', '[log] 上游失败']);
    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.tag)).toEqual(['请求失败', 'log']);
  });

  it('按标签判定严重级别', () => {
    const entries = parseSourceLogs([
      '[请求失败] a', '[调用失败] b', '[失败] c', '[error] d',
      '[warn] e', '[调用成功] f', '[已加载] g', '[log] h',
    ]);
    expect(entries.map((entry) => entry.tone))
      .toEqual(['danger', 'danger', 'danger', 'danger', 'warning', 'success', 'success', 'neutral']);
  });

  it('忽略空行，统计条数与异常条数', () => {
    const { entries, total, problems } = summarizeSourceLogs([
      '', '  ', '[请求失败] a', '[请求失败] a', '[log] b',
    ]);
    expect(entries).toHaveLength(2);
    expect(total).toBe(3);
    // 异常只算 danger 级别，且按归并后的次数累计
    expect(problems).toBe(2);
  });

  it('空日志得到空结果，界面据此隐藏整块', () => {
    expect(summarizeSourceLogs([])).toEqual({ entries: [], total: 0, problems: 0 });
  });
});
