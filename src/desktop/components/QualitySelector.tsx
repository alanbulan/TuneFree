import type { AudioQuality } from '../../core/types';
import { useId } from 'react';
import MotionChoice from './MotionChoice';

export const qualityOptions: AudioQuality[] = ['128k', '320k', 'flac', 'flac24bit'];

interface QualitySelectorProps {
  audioQuality: AudioQuality;
  onQualityChange: (quality: AudioQuality) => void;
}

/**
 * Renders the four quality toggle buttons (128K / 320K / FLAC / Hi-Res).
 * Shared between DesktopTransport and DesktopFullPlayer.
 */
export default function QualitySelector({ audioQuality, onQualityChange }: QualitySelectorProps) {
  const indicatorId = useId();
  return (
    <div className="quality-selector" role="group" aria-label="播放音质">
      {qualityOptions.map((quality) => (
        <MotionChoice
          key={quality}
          type="button"
          className="quality-button" selected={audioQuality === quality} indicatorId={indicatorId}
          onClick={() => onQualityChange(quality)}
        >
          {quality === 'flac24bit' ? 'Hi-Res' : quality.toUpperCase()}
        </MotionChoice>
      ))}
    </div>
  );
}
