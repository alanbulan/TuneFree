import type { ParsedLyric } from '../../../src/core/utils/lyrics';
import { KaraokeLyricText } from '../../../src/core/components/KaraokeLyricText';
import { SynchronizedTranslationText } from '../../../src/core/components/SynchronizedTranslationText';

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

type ExtensionLine = {
  text: string;
  type: 'translation' | 'romanization' | 'pronunciation' | 'other';
};

const getExtensionLines = (line: ParsedLyric): ExtensionLine[] => [
  { type: 'romanization' as const, text: line.romanization },
  { type: 'pronunciation' as const, text: line.pronunciation },
  { type: 'translation' as const, text: line.translation },
  ...(line.extra || []).map((item) => ({
    type: item.type === 'translation' ? 'translation' as const : 'other' as const,
    text: item.text,
  })),
].filter((item): item is ExtensionLine => !!item.text);

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
        color: active ? undefined : `rgba(248, 250, 252, ${contextOpacity})`,
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
          fontWeight: active ? 800 : 700,
          lineHeight: active ? 1.24 : 1.18,
        }}
      >
        {active && enableKaraoke ? <KaraokeLyricText line={line} currentTime={currentTime} source={source} dragRegion /> : line.text}
      </span>
      {extensionLines.map((extension, index) => (
        <em
          key={`${index}-${extension.text}`}
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
            fontWeight: active ? 650 : 600,
            lineHeight: active ? 1.26 : 1.16,
            marginTop: active ? '5px' : '2px',
            color: active
              ? 'var(--accent, #fa233b)'
              : `rgba(248, 250, 252, ${Math.max(0.1, contextOpacity * 0.72)})`,
          }}
        >
          {active && enableKaraoke && extension.type === 'translation' ? (
            <SynchronizedTranslationText
              line={line}
              text={extension.text}
              currentTime={currentTime}
              dragRegion
            />
          ) : extension.text}
        </em>
      ))}
    </div>
  );
}
