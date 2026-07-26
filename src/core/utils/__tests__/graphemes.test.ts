import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitGraphemes } from '../graphemes';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('splitGraphemes', () => {
  it('keeps multi-codepoint graphemes intact with the real segmenter', () => {
    expect(splitGraphemes('👨‍👩‍👧')).toEqual(['👨‍👩‍👧']);
    expect(splitGraphemes('与你相遇')).toEqual(['与', '你', '相', '遇']);
  });

  it('reuses a single cached Segmenter instance across calls', () => {
    let constructed = 0;
    class CountingSegmenter {
      constructor() {
        constructed += 1;
      }

      segment(input: string) {
        return Array.from(input).map((segment) => ({ segment }));
      }
    }
    vi.stubGlobal('Intl', { ...Intl, Segmenter: CountingSegmenter });

    expect(splitGraphemes('abc')).toEqual(['a', 'b', 'c']);
    expect(splitGraphemes('def')).toEqual(['d', 'e', 'f']);
    expect(splitGraphemes('ghi')).toEqual(['g', 'h', 'i']);
    expect(constructed).toBe(1);
  });

  it('rebuilds the cache when the Segmenter implementation is swapped', () => {
    let firstConstructed = 0;
    let secondConstructed = 0;
    const makeSegmenter = (onConstruct: () => void) => class {
      constructor() {
        onConstruct();
      }

      segment(input: string) {
        return Array.from(input).map((segment) => ({ segment }));
      }
    };

    vi.stubGlobal('Intl', { ...Intl, Segmenter: makeSegmenter(() => { firstConstructed += 1; }) });
    splitGraphemes('a');
    vi.stubGlobal('Intl', { ...Intl, Segmenter: makeSegmenter(() => { secondConstructed += 1; }) });
    splitGraphemes('b');
    splitGraphemes('c');

    expect(firstConstructed).toBe(1);
    expect(secondConstructed).toBe(1);
  });

  it('falls back to manual mark-merging splitting without a segmenter', () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    // か(か) + 结合浊点 ゙ 应合并为一个字素
    expect(splitGraphemes('がく')).toEqual(['が', 'く']);
  });
});
