import { describe, expect, it } from 'vitest';
import { hasTimedWords } from '../KaraokeLyricText';

describe('hasTimedWords', () => {
  it('accepts a single timed token', () => {
    expect(hasTimedWords({
      time: 1,
      text: 'Oh',
      words: [{ start: 1, duration: 0.5, text: 'Oh' }],
    })).toBe(true);
  });

  it('accepts a zero-duration punctuation token', () => {
    expect(hasTimedWords({
      time: 1,
      text: '，',
      words: [{ start: 1, duration: 0, text: '，' }],
    })).toBe(true);
  });

  it('rejects invalid or negative timing values', () => {
    expect(hasTimedWords({
      time: 1,
      text: 'invalid',
      words: [
        { start: Number.NaN, duration: 1, text: 'a' },
        { start: 1, duration: -1, text: 'b' },
      ],
    })).toBe(false);
  });
});
