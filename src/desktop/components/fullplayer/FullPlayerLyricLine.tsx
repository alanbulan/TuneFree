import { memo } from 'react';
import { KaraokeLyricText } from '../../../core/components/KaraokeLyricText';
import { getLyricLineTime, type ParsedLyric } from '../../../core/utils/lyrics';
import type { LyricDisplayMode } from '../../../core/utils/lyricDisplayMode';
import { getLyricExtensionLines } from '../../utils/formatting';

interface FullPlayerLyricLineProps {
  row: ParsedLyric;
  active: boolean;
  dim: boolean;
  currentTime: number;
  mode: LyricDisplayMode;
  offsetSeconds?: number;
  onSeek: (time: number) => void;
}

function FullPlayerLyricLine({ row, active, dim, currentTime, mode, onSeek, offsetSeconds = 0 }: FullPlayerLyricLineProps) {
  const seekLine = () => { if (!row.untimed) onSeek(Math.max(0, getLyricLineTime(row, mode) - offsetSeconds)); };
  return (
    <div role="listitem" tabIndex={0}
      className={`lyric-line${active ? ' active' : ''}${dim ? ' dim' : ''}`}
      data-active={active ? 'true' : undefined}
      onClick={seekLine} onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          seekLine();
        }
      }}>
      <span>{mode === 'karaoke' ? <KaraokeLyricText line={row} currentTime={currentTime} /> : row.text}</span>
      {getLyricExtensionLines(row).map((line, index) => <em key={`${index}-${line}`}>{line}</em>)}
    </div>
  );
}

export default memo(FullPlayerLyricLine);
