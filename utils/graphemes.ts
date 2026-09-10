/**
 * 按字素簇切分文本，并缓存 Intl.Segmenter 实例。
 * 构造 Segmenter 的开销不小，所以实例只创建一次并复用；
 * 缓存以构造函数为键，替换实现（polyfill、测试桩）时会自动重建。
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

/** 按用户感知的字符（字素簇）切分文本。 */
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
