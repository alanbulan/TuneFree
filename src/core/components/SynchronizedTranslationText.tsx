import { useMemo, type CSSProperties } from 'react';
import type { ParsedLyric, ParsedLyricWord } from '../utils/lyrics';
import { splitGraphemes } from '../utils/graphemes';
import {
  formatWordProgress,
  getLyricWordProgress,
  getLyricWordState,
  type LyricWordState,
} from '../utils/lyricWordState';

export type TranslationCharacterState = LyricWordState;

export type TranslationCharacter = {
  text: string;
  state?: TranslationCharacterState;
  progress?: number;
};

/**
 * Static plan derived from the line/text pair alone. Building it involves
 * grapheme segmentation, so the component memoizes it and only the cheap
 * per-clock resolution runs on every frame.
 */
export type TranslationPlan =
  | { kind: 'timed'; words: ParsedLyricWord[] }
  | { kind: 'projected'; words: ParsedLyricWord[]; characters: string[]; visibleCount: number };

const filterTimedWords = (words: ParsedLyricWord[] | undefined): ParsedLyricWord[] =>
  (words || []).filter((word) => (
    Number.isFinite(word.start)
    && Number.isFinite(word.duration)
    && word.duration >= 0
  ));

export const buildTranslationPlan = (line: ParsedLyric, text: string): TranslationPlan | null => {
  const translationWords = filterTimedWords(line.translationWords);
  if (
    translationWords.length > 0
    && translationWords.map((word) => word.text).join('') === text
  ) {
    return { kind: 'timed', words: translationWords };
  }

  const words = filterTimedWords(line.words);
  if (words.length === 0) return null;

  const characters = splitGraphemes(text);
  const visibleCount = characters.filter((character) => !/^\s$/u.test(character)).length;
  if (visibleCount === 0) return null;

  return { kind: 'projected', words, characters, visibleCount };
};

const resolveProjectedCharacters = (
  plan: Extract<TranslationPlan, { kind: 'projected' }>,
  currentTime: number,
): TranslationCharacter[] => {
  const { words, characters, visibleCount } = plan;
  const sourceProgress = words.reduce((total, word) => {
    if (word.duration === 0) return total + (currentTime >= word.start ? 1 : 0);
    return total + Math.max(0, Math.min(1, (currentTime - word.start) / word.duration));
  }, 0) / words.length;
  const sourceIsActive = words.some((word) => (
    word.duration > 0
    && currentTime >= word.start
    && currentTime < word.start + word.duration
  ));
  const exactProgress = sourceProgress * visibleCount;
  const completedCount = Math.min(visibleCount, Math.floor(exactProgress + Number.EPSILON));
  const activeProgress = Math.max(0, Math.min(1, exactProgress - completedCount));
  let visibleIndex = 0;

  return characters.map((character) => {
    if (/^\s$/u.test(character)) return { text: character };
    const done = sourceProgress >= 1 || visibleIndex < completedCount;
    const active = !done && sourceIsActive && visibleIndex === completedCount;
    visibleIndex += 1;
    return {
      text: character,
      state: done ? 'done' as const : active ? 'active' as const : 'pending' as const,
      progress: done ? 1 : active ? activeProgress : 0,
    };
  });
};

export const resolveTranslationCharacters = (
  plan: TranslationPlan,
  currentTime: number,
): TranslationCharacter[] => {
  if (plan.kind === 'timed') {
    return plan.words.map((word) => ({
      text: word.text,
      state: getLyricWordState(word.start, word.duration, currentTime),
      progress: getLyricWordProgress(word.start, word.duration, currentTime),
    }));
  }
  return resolveProjectedCharacters(plan, currentTime);
};

export const buildSynchronizedTranslation = (
  line: ParsedLyric,
  text: string,
  currentTime: number,
): TranslationCharacter[] | null => {
  const plan = buildTranslationPlan(line, text);
  return plan ? resolveTranslationCharacters(plan, currentTime) : null;
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
  const plan = useMemo(() => buildTranslationPlan(line, text), [line, text]);
  const characters = plan ? resolveTranslationCharacters(plan, currentTime) : null;
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
          style={{ '--word-progress': formatWordProgress(character.progress ?? 0) } as CSSProperties}
          data-text={character.text}
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
