'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DesktopLyricPlayerState, DesktopLyricStyleState } from '../_core/types';
import { LyricLineRenderer } from './LyricLineRenderer';

interface DesktopLyricStageProps {
  player: DesktopLyricPlayerState;
  styleState: DesktopLyricStyleState;
}

const getExtensionCount = (line?: { translation?: string; romanization?: string; pronunciation?: string; extra?: unknown[] } | null) => {
  if (!line) return 0;
  return [line.romanization, line.pronunciation, line.translation].filter(Boolean).length + (line.extra?.length || 0);
};

const MIN_COMPACT_FOCUS_SIZE = 12;

export function DesktopLyricStage({ player, styleState }: DesktopLyricStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const focusMeasureRef = useRef<HTMLDivElement>(null);
  const [stageHeight, setStageHeight] = useState(0);
  const [stageWidth, setStageWidth] = useState(0);
  const [focusSize, setFocusSize] = useState(styleState.size);
  const [focusContentHeight, setFocusContentHeight] = useState(0);
  const { song, rows, activeIndex, currentLine } = player;
  const { size } = styleState;
  const lyricClock = player.currentTime + player.lyricOffsetSeconds;
  const enableKaraoke = player.lyricDisplayMode === 'karaoke';
  const isDarkTheme = typeof document !== 'undefined' && document.documentElement.classList.contains('dark-theme');
  const activeShadow = getLyricTextShadow(true, isDarkTheme);
  const contextShadow = getLyricTextShadow(false, isDarkTheme);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const updateBounds = () => {
      setStageHeight(stage.clientHeight);
      setStageWidth(stage.clientWidth);
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

  useLayoutEffect(() => {
    setFocusSize(size);
  }, [currentLine, size, stageHeight, stageWidth]);

  useLayoutEffect(() => {
    const stage = stageRef.current;
    const focusMeasure = focusMeasureRef.current;
    if (!stage || !focusMeasure || !currentLine) {
      setFocusContentHeight(0);
      return;
    }

    const availableHeight = Math.max(1, stage.clientHeight);
    const measuredHeight = focusMeasure.scrollHeight;
    setFocusContentHeight((current) => current === measuredHeight ? current : measuredHeight);

    if (measuredHeight <= availableHeight + 1 || focusSize <= MIN_COMPACT_FOCUS_SIZE) {
      return;
    }

    const fittedSize = Math.floor(focusSize * (availableHeight / measuredHeight));
    const nextSize = Math.max(
      MIN_COMPACT_FOCUS_SIZE,
      Math.min(focusSize - 1, fittedSize),
    );
    if (nextSize !== focusSize) {
      setFocusSize(nextSize);
    }
  }, [currentLine, focusSize, stageHeight, stageWidth]);

  const contextDepth = useMemo(() => {
    if (rows.length === 0 || activeIndex < 0) return 0;

    // 桌面歌词没有可见边框，用户拖的是透明窗口边界；这里用实际舞台高度计算上下文容量。
    // 旧的 6 行上限在竖向大窗口里明显太少，这里提高到上下各 14 行，并按字号压缩行预算。
    const measuredHeight = stageHeight || (typeof window !== 'undefined' ? window.innerHeight - 68 : 0);
    if (measuredHeight < 140) return 0;

    const focusReserve = focusContentHeight > 0
      ? Math.min(measuredHeight, focusContentHeight)
      : size * (1.65 + getExtensionCount(currentLine) * 0.86);
    const maxContextExtensions = rows.reduce((max, row, index) => (
      index === activeIndex ? max : Math.max(max, getExtensionCount(row))
    ), 0);
    const contextPrimarySize = Math.max(12, Math.round(size * 0.6));
    const contextExtensionSize = Math.max(12, Math.round(size * 0.56));
    const contextLineBudget = (
      contextPrimarySize * 1.18
      + maxContextExtensions * (contextExtensionSize * 1.16 + 2)
      + 5
    );
    const availableHeight = Math.max(0, measuredHeight - focusReserve - 16);

    return Math.max(0, Math.min(14, Math.floor(availableHeight / (contextLineBudget * 2))));
  }, [activeIndex, currentLine, focusContentHeight, rows, size, stageHeight]);

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
            textAlign: 'center',
          }}
        >
          <span
            data-tauri-drag-region
            style={{
              display: 'block',
              fontSize: `${size}px`,
              fontWeight: 800,
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
              fontWeight: 600,
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

  const compact = contextDepth === 0;

  return (
    <div
      ref={stageRef}
      className={`desktop-lyric-stage${compact ? ' desktop-lyric-stage-compact' : ''}`}
      data-tauri-drag-region
    >
      {!compact && (
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
      )}

      <div className="desktop-lyric-focus" data-tauri-drag-region>
        <div className="desktop-lyric-focus-content" data-tauri-drag-region>
          <div ref={focusMeasureRef} className="desktop-lyric-focus-measure" data-tauri-drag-region>
            {currentLine && (
              <LyricLineRenderer
                key={`${currentLine.time}-${currentLine.text}`}
                line={currentLine}
                active
                size={focusSize}
                shadow={activeShadow}
                currentTime={lyricClock}
                source={song?.source}
                enableKaraoke={enableKaraoke}
              />
            )}
          </div>
        </div>
      </div>

      {!compact && (
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
      )}
    </div>
  );
}

const getLyricTextShadow = (active: boolean, dark: boolean) => {
  const base = dark ? 'rgba(0, 0, 0, .82)' : 'rgba(0, 0, 0, .7)';
  return active
    ? `0 1px 3px ${base}, 0 0 4px rgba(var(--accent-rgb), .14)`
    : `0 1px 3px ${base}`;
};
