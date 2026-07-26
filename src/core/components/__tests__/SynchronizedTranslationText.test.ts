import { describe, expect, it } from 'vitest';
import {
  buildSynchronizedTranslation,
  buildTranslationPlan,
  resolveTranslationCharacters,
} from '../SynchronizedTranslationText';

const timedLine = {
  time: 10,
  text: '君と出会えた',
  words: [
    { start: 10, duration: 1, text: '君と' },
    { start: 11, duration: 1, text: '出会えた' },
  ],
};

describe('buildSynchronizedTranslation', () => {
  it('maps Chinese translation characters onto the original word span', () => {
    const result = buildSynchronizedTranslation(timedLine, '与你相遇', 11);
    expect(result?.map((character) => character.state)).toEqual([
      'done', 'done', 'active', 'pending',
    ]);
  });

  it('preserves spaces while progressing Korean translations', () => {
    const result = buildSynchronizedTranslation(timedLine, '너를 만나', 10.5);
    expect(result?.map((character) => character.text).join('')).toBe('너를 만나');
    expect(result?.find((character) => character.text === ' ')?.state).toBeUndefined();
  });

  it('marks every character done after the original line finishes', () => {
    const result = buildSynchronizedTranslation(timedLine, '与你相遇', 12);
    expect(result?.every((character) => character.state === 'done')).toBe(true);
  });

  it('prefers real translation word timing when the translation track provides it', () => {
    const result = buildSynchronizedTranslation({
      ...timedLine,
      translationWords: [
        { start: 20, duration: 1, text: '与你' },
        { start: 22, duration: 1, text: '相遇' },
      ],
    }, '与你相遇', 21.5);
    expect(result).toEqual([
      { text: '与你', state: 'done', progress: 1 },
      { text: '相遇', state: 'pending', progress: 0 },
    ]);
  });

  it('exposes the intra-word fill ratio of the active character', () => {
    const result = buildSynchronizedTranslation(timedLine, '与你相遇', 11.25);
    expect(result?.map((character) => character.progress)).toEqual([1, 1, 0.5, 0]);
  });

  it('does not advance projected translation during gaps between original words', () => {
    const result = buildSynchronizedTranslation({
      ...timedLine,
      words: [
        { start: 10, duration: 1, text: '君と' },
        { start: 13, duration: 1, text: '出会えた' },
      ],
    }, '与你相遇', 12);
    expect(result?.map((character) => character.state)).toEqual([
      'done', 'done', 'pending', 'pending',
    ]);
  });

  it('keeps combined Japanese graphemes intact', () => {
    const result = buildSynchronizedTranslation(timedLine, 'がく', 10.5);
    expect(result?.map((character) => character.text)).toEqual(['が', 'く']);
  });

  it('returns null when the original line has no usable word timing', () => {
    expect(buildSynchronizedTranslation({ time: 1, text: 'plain' }, '普通歌词', 1)).toBeNull();
  });
});

describe('buildTranslationPlan', () => {
  it('segments the translation once and resolves states per clock', () => {
    const plan = buildTranslationPlan(timedLine, '与你相遇');
    expect(plan).toMatchObject({ kind: 'projected', visibleCount: 4 });
    if (!plan) throw new Error('plan expected');

    expect(resolveTranslationCharacters(plan, 9).map((item) => item.state)).toEqual([
      'pending', 'pending', 'pending', 'pending',
    ]);
    expect(resolveTranslationCharacters(plan, 12).map((item) => item.state)).toEqual([
      'done', 'done', 'done', 'done',
    ]);
  });

  it('returns a timed plan without grapheme segmentation when timings line up', () => {
    const plan = buildTranslationPlan({
      ...timedLine,
      translationWords: [
        { start: 20, duration: 1, text: '与你' },
        { start: 22, duration: 1, text: '相遇' },
      ],
    }, '与你相遇');
    expect(plan?.kind).toBe('timed');
  });
});
