import { useState } from 'react';
import { formatTime } from '../utils/formatting';

interface PlayerProgressSliderProps {
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
}

const COMMIT_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

const clampTime = (value: number, duration: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(Math.max(value, 0), duration);
};

export default function PlayerProgressSlider({ currentTime, duration, onSeek }: PlayerProgressSliderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);
  const max = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const displayTime = isDragging ? previewTime : currentTime;
  const sliderValue = max ? clampTime(displayTime, max) : 0;

  const updatePreview = (value: number) => {
    setIsDragging(true);
    setPreviewTime(clampTime(value, max));
  };

  const commitSeek = (value: number) => {
    if (!max) return;
    const nextTime = clampTime(value, max);
    setPreviewTime(nextTime);
    setIsDragging(false);
    onSeek(nextTime);
  };

  const cancelPreview = () => {
    setIsDragging(false);
    setPreviewTime(clampTime(currentTime, max));
  };

  return (
    <div className="progress-row">
      <span>{formatTime(sliderValue)}</span>
      <input
        className="progress-bar"
        aria-label="播放进度"
        type="range"
        min={0}
        max={max}
        value={sliderValue}
        onPointerDown={(event) => {
          if (!max) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          updatePreview(Number(event.currentTarget.value));
        }}
        onInput={(event) => updatePreview(Number(event.currentTarget.value))}
        onChange={(event) => updatePreview(Number(event.currentTarget.value))}
        onPointerUp={(event) => commitSeek(Number(event.currentTarget.value))}
        onPointerCancel={cancelPreview}
        onBlur={cancelPreview}
        onKeyUp={(event) => {
          if (COMMIT_KEYS.has(event.key)) {
            commitSeek(Number(event.currentTarget.value));
          }
        }}
        disabled={!max}
      />
      <span>{formatTime(duration)}</span>
    </div>
  );
}
