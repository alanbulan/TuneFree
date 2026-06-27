import type { AudioQuality } from '../../core/types';

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
  return (
    <>
      {qualityOptions.map((quality) => (
        <button
          key={quality}
          type="button"
          className={`quality-button ${audioQuality === quality ? 'active' : ''}`}
          aria-pressed={audioQuality === quality}
          onClick={() => onQualityChange(quality)}
        >
          {quality === 'flac24bit' ? 'Hi-Res' : quality.toUpperCase()}
        </button>
      ))}
    </>
  );
}
