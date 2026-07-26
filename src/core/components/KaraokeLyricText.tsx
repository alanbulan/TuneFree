import type { CSSProperties } from 'react';
import type { ParsedLyric } from '../utils/lyrics';
import {
  formatWordProgress,
  getLyricWordProgress,
  getLyricWordState,
} from '../utils/lyricWordState';

interface KaraokeLyricTextProps {
  line: ParsedLyric;
  currentTime: number;
  source?: string;
  dragRegion?: boolean;
}

export function hasTimedWords(line?: ParsedLyric | null): line is ParsedLyric & Required<Pick<ParsedLyric, 'words'>> {
  return (line?.words?.filter((word) => (
    Number.isFinite(word.start)
    && Number.isFinite(word.duration)
    && word.duration >= 0
  )).length || 0) > 0;
}

export function KaraokeLyricText({ line, currentTime, dragRegion = false }: KaraokeLyricTextProps) {
  if (!hasTimedWords(line)) {
    return <>{line.text}</>;
  }

  return (
    <span className="karaoke-line" aria-label={line.text} data-tauri-drag-region={dragRegion ? true : undefined}>
      {line.words.map((word, index) => {
        const state = getLyricWordState(word.start, word.duration, currentTime);
        const progress = getLyricWordProgress(word.start, word.duration, currentTime);

        return (
          <span
            key={`${index}-${word.start}-${word.text}`}
            className={`karaoke-word ${state}`}
            style={{ '--word-progress': formatWordProgress(progress) } as CSSProperties}
            aria-hidden="true"
            data-tauri-drag-region={dragRegion ? true : undefined}
          >
            {word.text}
          </span>
        );
      })}
    </span>
  );
}
