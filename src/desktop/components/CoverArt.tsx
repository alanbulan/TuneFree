import { MusicIcon } from '../../core/components/Icons';
import { getImgReferrerPolicy } from '../../core/services/api';

interface CoverArtProps {
  src?: string;
  alt: string;
  className?: string;
  iconSize?: number;
}

export default function CoverArt({ src, alt, className = 'cover-art', iconSize = 42 }: CoverArtProps) {
  return (
    <div className={className}>
      {src ? (
        <img src={src} alt={alt} referrerPolicy={getImgReferrerPolicy(src)} loading="lazy" />
      ) : (
        <MusicIcon size={iconSize} className="muted-text" />
      )}
    </div>
  );
}
