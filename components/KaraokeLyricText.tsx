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
}

/** 该行是否带有可用的逐字时间轴。 */
export function hasTimedWords(line?: ParsedLyric | null): line is ParsedLyric & Required<Pick<ParsedLyric, 'words'>> {
  return (line?.words?.filter((word) => (
    Number.isFinite(word.start)
    && Number.isFinite(word.duration)
    && word.duration >= 0
  )).length || 0) > 0;
}

/**
 * 逐字歌词渲染。
 * 每个字渲染两层：底层是未唱的底色，::after 用 data-text 复制一份高亮色，
 * 再用 --word-progress 控制 clip-path 的裁剪宽度，得到逐字扫过的填充效果。
 */
export function KaraokeLyricText({ line, currentTime }: KaraokeLyricTextProps) {
  if (!hasTimedWords(line)) {
    return <>{line.text}</>;
  }

  return (
    <span className="karaoke-line" aria-label={line.text}>
      {line.words.map((word, index) => {
        const state = getLyricWordState(word.start, word.duration, currentTime);
        const progress = getLyricWordProgress(word.start, word.duration, currentTime);

        return (
          <span
            key={`${index}-${word.start}-${word.text}`}
            className={`karaoke-word ${state}`}
            style={{ '--word-progress': formatWordProgress(progress) } as CSSProperties}
            data-text={word.text}
            aria-hidden="true"
          >
            {word.text}
          </span>
        );
      })}
    </span>
  );
}
