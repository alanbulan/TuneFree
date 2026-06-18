'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DesktopLyricPlayerState, DesktopLyricStyleState } from '../_core/types';
import { LyricLineRenderer } from './LyricLineRenderer';

interface DesktopLyricStageProps {
  player: DesktopLyricPlayerState;
  styleState: DesktopLyricStyleState;
}

export function DesktopLyricStage({ player, styleState }: DesktopLyricStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState(0);
  const { song, rows, activeIndex, currentLine } = player;
  const { size } = styleState;
  const isDarkTheme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark-theme');
  const activeShadow = getLyricTextShadow(true, isDarkTheme);
  const contextShadow = getLyricTextShadow(false, isDarkTheme);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateBounds = () => {
      setStageHeight(stage.clientHeight);
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(stage);
    window.addEventListener('resize', updateBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateBounds);
    };
  }, []);

  const contextDepth = useMemo(() => {
    if (rows.length === 0 || activeIndex < 0) return 0;

    // 桌面歌词没有可见边框，用户拖的是透明窗口边界；这里用实际舞台高度计算上下文容量。
    // 旧的 6 行上限在竖向大窗口里明显太少，这里提高到上下各 14 行，并按字号压缩行预算。
    const measuredHeight = stageHeight || (typeof window !== 'undefined' ? window.innerHeight - 68 : 0);
    if (measuredHeight < 140) return 0;

    const focusReserve = currentLine?.translation ? size * 2.65 : size * 1.65;
    const contextLineBudget = Math.max(15, size * 0.82);
    const availableHeight = Math.max(0, measuredHeight - focusReserve - 14);

    return Math.max(0, Math.min(14, Math.floor(availableHeight / (contextLineBudget * 2))));
  }, [activeIndex, currentLine?.translation, rows.length, size, stageHeight]);

  const previousLines = contextDepth > 0 && activeIndex > 0
    ? rows.slice(Math.max(0, activeIndex - contextDepth), activeIndex)
    : [];
  const nextLines = contextDepth > 0 && activeIndex >= 0
    ? rows.slice(activeIndex + 1, activeIndex + 1 + contextDepth)
    : [];

  if (rows.length === 0) {
    return (
      <div ref={stageRef} className="desktop-lyric-stage desktop-lyric-stage-empty" data-tauri-drag-region>
        <div
          className="desktop-lyric-current-line"
          data-tauri-drag-region
          style={{
            color: 'var(--accent, #fa233b)',
            textShadow: activeShadow,
            WebkitTextStroke: '0.62px rgba(0, 0, 0, 0.86)',
            paintOrder: 'stroke fill',
            textAlign: 'center',
          }}
        >
          <span
            data-tauri-drag-region
            style={{
              display: 'block',
              fontSize: `${size}px`,
              fontWeight: 860,
              lineHeight: 1.26,
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {song?.name || 'TuneFree Desktop'}
          </span>
          <em
            data-tauri-drag-region
            style={{
              display: 'block',
              marginTop: '6px',
              fontSize: `${Math.max(12, Math.round(size * 0.68))}px`,
              fontStyle: 'normal',
              fontWeight: 620,
              opacity: 0.72,
              lineHeight: 1.26,
            }}
          >
            {song?.artist || '听你想听'}
          </em>
        </div>
      </div>
    );
  }

  return (
    <div ref={stageRef} className="desktop-lyric-stage" data-tauri-drag-region>
      <div className="desktop-lyric-context desktop-lyric-context-top" data-tauri-drag-region>
        {previousLines.map((line, index) => (
          <LyricLineRenderer
            key={`prev-${line.time}-${index}`}
            line={line}
            size={size}
            shadow={contextShadow}
            depth={previousLines.length - index}
          />
        ))}
      </div>

      <div className="desktop-lyric-focus" data-tauri-drag-region>
        {currentLine && <LyricLineRenderer line={currentLine} active size={size} shadow={activeShadow} />}
      </div>

      <div className="desktop-lyric-context desktop-lyric-context-bottom" data-tauri-drag-region>
        {nextLines.map((line, index) => (
          <LyricLineRenderer
            key={`next-${line.time}-${index}`}
            line={line}
            size={size}
            shadow={contextShadow}
            depth={index + 1}
          />
        ))}
      </div>
    </div>
  );
}

const getLyricTextShadow = (active: boolean, dark: boolean) => {
  const halo = active ? '0 0 18px rgba(var(--accent-rgb), .28)' : '0 0 10px rgba(0, 0, 0, .36)';
  const base = dark ? 'rgba(0, 0, 0, .86)' : 'rgba(0, 0, 0, .78)';
  return active
    ? `0 2px 10px ${base}, ${halo}`
    : `0 1px 8px ${base}, ${halo}`;
};
