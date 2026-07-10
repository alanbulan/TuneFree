'use client';

import { useState } from 'react';
import { DesktopLyricResizeHandles } from './_components/DesktopLyricResizeHandles';
import { DesktopLyricStage } from './_components/DesktopLyricStage';
import { DesktopLyricToolbar } from './_components/DesktopLyricToolbar';
import { useDesktopLyricBridge } from './_core/useDesktopLyricBridge';

export default function DesktopLyricPage() {
  const [isHovered, setIsHovered] = useState(false);
  const { playerState, styleState, controls } = useDesktopLyricBridge();
  const showToolbar = isHovered && !styleState.lock;

  return (
    <div
      className="desktop-lyric-root"
      onMouseEnter={() => !styleState.lock && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{ fontFamily: styleState.font }}
    >
      {showToolbar && (
        <DesktopLyricToolbar
          isPlaying={playerState.isPlaying}
          onPrev={controls.prev}
          onPlayPause={controls.playPause}
          onNext={controls.next}
          onSizeUp={() => controls.adjustLyricSize(2)}
          onSizeDown={() => controls.adjustLyricSize(-2)}
          onLock={controls.lock}
          onClose={controls.close}
        />
      )}

      <DesktopLyricStage player={playerState} styleState={styleState} />
      <DesktopLyricResizeHandles disabled={styleState.lock} />

      <style>{`
        html,
        body,
        #root,
        body > div:first-child {
          height: 100% !important;
          max-height: 100vh !important;
          max-height: 100dvh !important;
          overflow: hidden !important;
          background: transparent !important;
          background-color: transparent !important;
        }

        .desktop-lyric-root {
          width: 100%;
          height: 100dvh;
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 46px 34px 22px;
          overflow: hidden;
          background: transparent;
          user-select: none;
        }

        .desktop-lyric-toolbar {
          position: absolute;
          top: 8px;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 20px;
          color: #f8fafc;
          background: rgba(15, 23, 42, 0.72);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25), inset 0 0 0 1px rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(12px);
          z-index: 100;
          animation: desktopLyricToolbarIn 0.15s ease-out;
        }

        .desktop-lyric-drag-handle {
          display: flex;
          align-items: center;
          padding: 0 4px;
          cursor: move;
          opacity: 0.6;
        }

        .desktop-lyric-stage {
          width: min(100%, 1180px);
          height: 100%;
          display: grid;
          grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
          align-items: center;
          justify-items: center;
          row-gap: 8px;
          overflow: hidden;
          cursor: move;
          text-align: center;
        }

        .desktop-lyric-stage-empty {
          grid-template-rows: 1fr;
        }

        .desktop-lyric-context {
          width: 100%;
          min-height: 0;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 5px;
          color: #f8fafc;
          opacity: 1;
          filter: blur(0.1px);
        }

        .desktop-lyric-context-top {
          align-self: end;
          justify-content: flex-end;
        }

        .desktop-lyric-context-bottom {
          align-self: start;
          justify-content: flex-start;
        }

        .desktop-lyric-focus {
          width: 100%;
          max-width: 100%;
          min-height: 2.35em;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--accent, #fa233b);
          overflow: visible;
          z-index: 2;
        }

        .desktop-lyric-current-line,
        .desktop-lyric-context-line {
          width: 100%;
          max-width: 100%;
          overflow: visible;
        }

        .desktop-lyric-resize-layer {
          position: absolute;
          inset: 0;
          z-index: 80;
          pointer-events: none;
        }

        .desktop-lyric-resize-handle {
          position: absolute;
          display: block;
          padding: 0;
          margin: 0;
          border: 0;
          background: transparent;
          pointer-events: auto;
          opacity: 0;
        }

        .desktop-lyric-resize-n,
        .desktop-lyric-resize-s {
          left: 18px;
          right: 18px;
          height: 12px;
          cursor: ns-resize;
        }

        .desktop-lyric-resize-n {
          top: 0;
        }

        .desktop-lyric-resize-s {
          bottom: 0;
        }

        .desktop-lyric-resize-w,
        .desktop-lyric-resize-e {
          top: 18px;
          bottom: 18px;
          width: 12px;
          cursor: ew-resize;
        }

        .desktop-lyric-resize-w {
          left: 0;
        }

        .desktop-lyric-resize-e {
          right: 0;
        }

        .desktop-lyric-resize-nw,
        .desktop-lyric-resize-ne,
        .desktop-lyric-resize-sw,
        .desktop-lyric-resize-se {
          width: 22px;
          height: 22px;
        }

        .desktop-lyric-resize-nw {
          top: 0;
          left: 0;
          cursor: nwse-resize;
        }

        .desktop-lyric-resize-ne {
          top: 0;
          right: 0;
          cursor: nesw-resize;
        }

        .desktop-lyric-resize-sw {
          bottom: 0;
          left: 0;
          cursor: nesw-resize;
        }

        .desktop-lyric-resize-se {
          bottom: 0;
          right: 0;
          cursor: nwse-resize;
        }

        @keyframes desktopLyricToolbarIn {
          from {
            opacity: 0;
            transform: translateY(-4px) translateX(-50%);
          }
          to {
            opacity: 1;
            transform: translateY(0) translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}
