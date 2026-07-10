import type { CSSProperties } from 'react';
import type { ParsedLyric } from '../utils/lyrics';

interface KaraokeLyricTextProps {
  line: ParsedLyric;
  currentTime: number;
  source?: string;
  dragRegion?: boolean;
}

const getKaraokeClock = (currentTime: number): number => currentTime;

const getWordState = (start: number, duration: number, currentTime: number): 'active' | 'done' | 'pending' => {
  if (duration === 0) return currentTime < start ? 'pending' : 'done';
  if (currentTime >= start + duration) return 'done';
  if (currentTime >= start) return 'active';
  return 'pending';
};

const getWordProgress = (start: number, duration: number, currentTime: number): number => {
  if (duration === 0) return currentTime < start ? 0 : 1;
  return Math.max(0, Math.min(1, (currentTime - start) / duration));
};

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

  const karaokeClock = getKaraokeClock(currentTime);

  return (
    <span className="karaoke-line" aria-label={line.text} data-tauri-drag-region={dragRegion ? true : undefined}>
      {line.words.map((word, index) => {
        const state = getWordState(word.start, word.duration, karaokeClock);
        const progress = getWordProgress(word.start, word.duration, karaokeClock);

        return (
          <span
            key={`${index}-${word.start}-${word.text}`}
            className={`karaoke-word ${state}`}
            style={{ '--word-progress': progress } as CSSProperties}
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
