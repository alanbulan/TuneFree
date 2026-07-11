import type { ParsedLyric } from '../utils/lyrics';

export type TranslationCharacterState = 'active' | 'done' | 'pending';

export type TranslationCharacter = {
  text: string;
  state?: TranslationCharacterState;
};

type SegmenterLike = { segment: (input: string) => Iterable<{ segment: string }> };
type SegmenterConstructor = new (
  locale?: string,
  options?: { granularity: 'grapheme' },
) => SegmenterLike;

const splitCharactersFallback = (text: string): string[] => Array.from(text).reduce<string[]>((result, unit) => {
  if (/\p{Mark}/u.test(unit) && result.length > 0) {
    result[result.length - 1] += unit;
  } else {
    result.push(unit);
  }
  return result;
}, []);

const splitCharacters = (text: string): string[] => {
  const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter;
  return Segmenter
    ? Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => segment)
    : splitCharactersFallback(text);
};

const getTimedState = (
  start: number,
  duration: number,
  currentTime: number,
): TranslationCharacterState => {
  if (duration === 0) return currentTime < start ? 'pending' : 'done';
  if (currentTime >= start + duration) return 'done';
  if (currentTime >= start) return 'active';
  return 'pending';
};

export const buildSynchronizedTranslation = (
  line: ParsedLyric,
  text: string,
  currentTime: number,
): TranslationCharacter[] | null => {
  const translationWords = (line.translationWords || []).filter((word) => (
    Number.isFinite(word.start)
    && Number.isFinite(word.duration)
    && word.duration >= 0
  ));
  if (
    translationWords.length > 0
    && translationWords.map((word) => word.text).join('') === text
  ) {
    return translationWords.map((word) => ({
      text: word.text,
      state: getTimedState(word.start, word.duration, currentTime),
    }));
  }

  const words = (line.words || []).filter((word) => (
    Number.isFinite(word.start)
    && Number.isFinite(word.duration)
    && word.duration >= 0
  ));
  if (words.length === 0) return null;

  const characters = splitCharacters(text);
  const visibleCount = characters.filter((character) => !/^\s$/u.test(character)).length;
  if (visibleCount === 0) return null;

  const sourceProgress = words.reduce((total, word) => {
    if (word.duration === 0) return total + (currentTime >= word.start ? 1 : 0);
    return total + Math.max(0, Math.min(1, (currentTime - word.start) / word.duration));
  }, 0) / words.length;
  const sourceIsActive = words.some((word) => (
    word.duration > 0
    && currentTime >= word.start
    && currentTime < word.start + word.duration
  ));
  const completedCount = Math.min(
    visibleCount,
    Math.floor(sourceProgress * visibleCount + Number.EPSILON),
  );
  let visibleIndex = 0;

  return characters.map((character) => {
    if (/^\s$/u.test(character)) return { text: character };
    const state: TranslationCharacterState = sourceProgress >= 1 || visibleIndex < completedCount
      ? 'done'
      : sourceIsActive && visibleIndex === completedCount ? 'active' : 'pending';
    visibleIndex += 1;
    return { text: character, state };
  });
};

interface SynchronizedTranslationTextProps {
  line: ParsedLyric;
  text: string;
  currentTime: number;
  dragRegion?: boolean;
}

export function SynchronizedTranslationText({
  line,
  text,
  currentTime,
  dragRegion = false,
}: SynchronizedTranslationTextProps) {
  const characters = buildSynchronizedTranslation(line, text, currentTime);
  if (!characters) return <>{text}</>;

  return (
    <span
      className="karaoke-line karaoke-translation-line"
      aria-label={text}
      data-tauri-drag-region={dragRegion ? true : undefined}
    >
      {characters.map((character, index) => character.state ? (
        <span
          key={`${index}-${character.text}`}
          className={`karaoke-word karaoke-translation-character ${character.state}`}
          aria-hidden="true"
          data-tauri-drag-region={dragRegion ? true : undefined}
        >
          {character.text}
        </span>
      ) : (
        <span
          key={`${index}-space`}
          className="karaoke-translation-space"
          aria-hidden="true"
          data-tauri-drag-region={dragRegion ? true : undefined}
        >
          {character.text}
        </span>
      ))}
    </span>
  );
}
