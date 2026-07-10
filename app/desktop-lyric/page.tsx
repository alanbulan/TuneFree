'use client';

import { useState } from 'react';
import './desktop-lyric.css';
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
    </div>
  );
}
