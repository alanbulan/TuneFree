import type { ParsedLyric } from '../../../src/core/utils/lyrics';
import { KaraokeLyricText } from '../../../src/core/components/KaraokeLyricText';

interface LyricLineRendererProps {
  line: ParsedLyric;
  active?: boolean;
  size: number;
  shadow: string;
  align?: 'left' | 'center' | 'right';
  depth?: number;
  currentTime?: number;
  source?: string;
  enableKaraoke?: boolean;
}

const getExtensionLines = (line: ParsedLyric): string[] => [
  line.romanization,
  line.pronunciation,
  line.translation,
  ...(line.extra || []).map((item) => item.text),
].filter((text): text is string => !!text);

export function LyricLineRenderer({ line, active = false, size, shadow, align = 'center', depth = 1, currentTime = 0, source, enableKaraoke = false }: LyricLineRendererProps) {
  const extensionSize = Math.max(12, Math.round(size * (active ? 0.68 : 0.56)));
  const contextOpacity = Math.max(0.12, 0.7 - Math.max(0, depth - 1) * 0.055);
  const extensionLines = getExtensionLines(line);

  return (
    <div
      className={active ? 'desktop-lyric-current-line' : 'desktop-lyric-context-line'}
      data-tauri-drag-region
      style={{
        textAlign: align,
        textShadow: shadow,
        WebkitTextStroke: active ? '0.62px rgba(0, 0, 0, 0.86)' : '0.34px rgba(0, 0, 0, 0.74)',
        paintOrder: 'stroke fill',
        opacity: active ? 1 : contextOpacity,
      }}
    >
      <span
        data-tauri-drag-region
        style={{
          display: active ? 'block' : '-webkit-box',
          overflow: active ? 'visible' : 'hidden',
          overflowWrap: 'anywhere',
          wordBreak: 'break-word',
          whiteSpace: 'pre-line',
          WebkitLineClamp: active ? undefined : 1,
          WebkitBoxOrient: 'vertical',
          fontSize: active ? `${size}px` : `${Math.max(12, Math.round(size * 0.6))}px`,
          fontWeight: active ? 860 : 720,
          lineHeight: active ? 1.24 : 1.18,
        }}
      >
        {active && enableKaraoke ? <KaraokeLyricText line={line} currentTime={currentTime} source={source} dragRegion /> : line.text}
      </span>
      {extensionLines.map((text, index) => (
        <em
          key={`${index}-${text}`}
          data-tauri-drag-region
          style={{
            display: active ? 'block' : '-webkit-box',
            overflow: active ? 'visible' : 'hidden',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            whiteSpace: 'pre-line',
            WebkitLineClamp: active ? undefined : 1,
            WebkitBoxOrient: 'vertical',
            fontSize: `${extensionSize}px`,
            fontStyle: 'normal',
            fontWeight: active ? 680 : 620,
            lineHeight: active ? 1.26 : 1.16,
            marginTop: active ? '5px' : '2px',
            opacity: active ? Math.max(0.62, 0.88 - index * 0.08) : Math.max(0.1, contextOpacity * 0.72),
          }}
        >
          {text}
        </em>
      ))}
    </div>
  );
}
