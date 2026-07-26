import { describe, expect, it } from 'vitest';
import { computeVirtualWindow, isSameVirtualWindow } from '../virtualWindow';

describe('computeVirtualWindow', () => {
  it('从顶部开始时窗口贴住 0 并带上 overscan', () => {
    expect(computeVirtualWindow(0, 560, 56, 100, 6)).toEqual({ start: 0, end: 16 });
  });

  it('同一行内的连续滚动帧算出同一个窗口', () => {
    const base = computeVirtualWindow(1, 560, 56, 100, 6);
    for (const offset of [12, 33, 55, 56]) {
      expect(computeVirtualWindow(offset, 560, 56, 100, 6)).toEqual(base);
    }
  });

  it('跨过一行边界时窗口才前进一格', () => {
    expect(computeVirtualWindow(56, 560, 56, 100, 6)).toEqual({ start: 0, end: 17 });
    expect(computeVirtualWindow(57, 560, 56, 100, 6)).toEqual({ start: 0, end: 18 });
    expect(computeVirtualWindow(560, 560, 56, 100, 6)).toEqual({ start: 4, end: 26 });
  });

  it('末尾不会越过总数', () => {
    expect(computeVirtualWindow(100 * 56, 560, 56, 100, 6)).toEqual({ start: 94, end: 100 });
  });

  it('容错非法尺寸与负偏移', () => {
    expect(computeVirtualWindow(-40, 560, 56, 100, 6)).toEqual({ start: 0, end: 16 });
    expect(computeVirtualWindow(Number.NaN, 560, 0, 100, 6)).toEqual({ start: 0, end: 100 });
  });
});

describe('isSameVirtualWindow', () => {
  it('只在两端都相同时才算同一个窗口', () => {
    expect(isSameVirtualWindow({ start: 3, end: 9 }, { start: 3, end: 9 })).toBe(true);
    expect(isSameVirtualWindow({ start: 3, end: 9 }, { start: 3, end: 10 })).toBe(false);
    expect(isSameVirtualWindow({ start: 2, end: 9 }, { start: 3, end: 9 })).toBe(false);
  });
});
