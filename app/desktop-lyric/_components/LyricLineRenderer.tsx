import type { ParsedLyric } from '../../../src/core/utils/lyrics';

interface LyricLineRendererProps {
  line: ParsedLyric;
  active?: boolean;
  size: number;
  shadow: string;
  align?: 'left' | 'center' | 'right';
  depth?: number;
}

export function LyricLineRenderer({ line, active = false, size, shadow, align = 'center', depth = 1 }: LyricLineRendererProps) {
  const translationSize = Math.max(12, Math.round(size * (active ? 0.68 : 0.56)));
  const contextOpacity = Math.max(0.12, 0.7 - Math.max(0, depth - 1) * 0.055);

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
          WebkitLineClamp: active ? undefined : 1,
          WebkitBoxOrient: 'vertical',
          fontSize: active ? `${size}px` : `${Math.max(12, Math.round(size * 0.6))}px`,
          fontWeight: active ? 860 : 720,
          lineHeight: active ? 1.24 : 1.18,
        }}
      >
        {line.text}
      </span>
      {line.translation && (
        <em
          data-tauri-drag-region
          style={{
            display: active ? 'block' : '-webkit-box',
            overflow: active ? 'visible' : 'hidden',
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            WebkitLineClamp: active ? undefined : 1,
            WebkitBoxOrient: 'vertical',
            fontSize: `${translationSize}px`,
            fontStyle: 'normal',
            fontWeight: active ? 680 : 620,
            lineHeight: active ? 1.26 : 1.16,
            marginTop: active ? '5px' : '2px',
            opacity: active ? 0.86 : Math.max(0.1, contextOpacity * 0.72),
          }}
        >
          {line.translation}
        </em>
      )}
    </div>
  );
}
