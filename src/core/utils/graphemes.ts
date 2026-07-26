/**
 * Grapheme-aware text splitting with a module-level cached Intl.Segmenter.
 * Constructing a Segmenter is expensive, so the instance is created once and
 * reused; the cache is keyed on the constructor so a swapped implementation
 * (polyfill, test stub) transparently rebuilds the instance.
 */

type GraphemeSegmenter = { segment: (input: string) => Iterable<{ segment: string }> };
type GraphemeSegmenterConstructor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter;

const getSegmenterConstructor = (): GraphemeSegmenterConstructor | undefined =>
  (Intl as unknown as { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;

let cachedConstructor: GraphemeSegmenterConstructor | undefined;
let cachedSegmenter: GraphemeSegmenter | undefined;

const splitGraphemesFallback = (text: string): string[] =>
  Array.from(text).reduce<string[]>((result, unit) => {
    if (/\p{Mark}/u.test(unit) && result.length > 0) {
      result[result.length - 1] += unit;
    } else {
      result.push(unit);
    }
    return result;
  }, []);

/** Split text into user-perceived characters (grapheme clusters). */
export const splitGraphemes = (text: string): string[] => {
  const SegmenterCtor = getSegmenterConstructor();
  if (!SegmenterCtor) return splitGraphemesFallback(text);

  let segmenter = cachedSegmenter;
  if (!segmenter || SegmenterCtor !== cachedConstructor) {
    segmenter = new SegmenterCtor(undefined, { granularity: 'grapheme' });
    cachedConstructor = SegmenterCtor;
    cachedSegmenter = segmenter;
  }
  return Array.from(segmenter.segment(text), ({ segment }) => segment);
};
