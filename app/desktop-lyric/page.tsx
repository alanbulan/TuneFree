'use client';

import { useState } from 'react';
import './desktop-lyric.css';
import { DesktopLyricResizeHandles } from './_components/DesktopLyricResizeHandles';
import { DesktopLyricStage } from './_components/DesktopLyricStage';
import { DesktopLyricToolbar } from './_components/DesktopLyricToolbar';
import { useDesktopLyricBridge } from './_core/useDesktopLyricBridge';

export default function DesktopLyricPage() {
  const [isHovered, setIsHovered] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const { playerState, styleState, controls } = useDesktopLyricBridge();
  const showToolbar = (isHovered || isFocusWithin) && !styleState.lock;

  return (
    <div
      className="desktop-lyric-root"
      data-tauri-drag-region
      tabIndex={styleState.lock ? -1 : 0}
      role="region"
      aria-label="桌面歌词控制区域"
      onMouseEnter={() => !styleState.lock && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => !styleState.lock && setIsFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsFocusWithin(false);
        }
      }}
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
    </div>
  );
}
