import { describe, expect, it } from 'vitest';
import {
  formatWordProgress,
  getLyricWordProgress,
  getLyricWordState,
} from '../lyricWordState';

describe('getLyricWordState', () => {
  it('walks pending → active → done across the word duration', () => {
    expect(getLyricWordState(10, 2, 9.99)).toBe('pending');
    expect(getLyricWordState(10, 2, 10)).toBe('active');
    expect(getLyricWordState(10, 2, 11.99)).toBe('active');
    expect(getLyricWordState(10, 2, 12)).toBe('done');
  });

  it('treats zero-duration tokens as an instant pending → done flip', () => {
    expect(getLyricWordState(5, 0, 4.99)).toBe('pending');
    expect(getLyricWordState(5, 0, 5)).toBe('done');
  });
});

describe('getLyricWordProgress', () => {
  it('interpolates linearly and clamps to the 0..1 range', () => {
    expect(getLyricWordProgress(10, 2, 8)).toBe(0);
    expect(getLyricWordProgress(10, 2, 11)).toBe(0.5);
    expect(getLyricWordProgress(10, 2, 14)).toBe(1);
  });

  it('treats zero-duration tokens as an instant 0 → 1 flip', () => {
    expect(getLyricWordProgress(5, 0, 4.99)).toBe(0);
    expect(getLyricWordProgress(5, 0, 5)).toBe(1);
  });
});

describe('formatWordProgress', () => {
  it('formats a ratio as a CSS percentage with one decimal', () => {
    expect(formatWordProgress(0)).toBe('0.0%');
    expect(formatWordProgress(0.375)).toBe('37.5%');
    expect(formatWordProgress(1)).toBe('100.0%');
  });

  it('clamps out-of-range and non-finite input', () => {
    expect(formatWordProgress(-0.5)).toBe('0.0%');
    expect(formatWordProgress(1.5)).toBe('100.0%');
    expect(formatWordProgress(Number.NaN)).toBe('0.0%');
  });
});
