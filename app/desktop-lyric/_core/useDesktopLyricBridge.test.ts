import { describe, expect, it } from 'vitest';
import type { ParsedLyric } from '../../../src/core/utils/lyrics';
import { getDesktopLyricCurrentLine } from './useDesktopLyricBridge';

const rows: ParsedLyric[] = [
  { time: 20, text: '第一句' },
  { time: 25, text: '第二句' },
];

describe('getDesktopLyricCurrentLine', () => {
  it('previews the first row before its timestamp', () => {
    expect(getDesktopLyricCurrentLine(rows, -1)).toBe(rows[0]);
  });

  it('returns the active row after its timestamp is reached', () => {
    expect(getDesktopLyricCurrentLine(rows, 0)).toBe(rows[0]);
  });
});
