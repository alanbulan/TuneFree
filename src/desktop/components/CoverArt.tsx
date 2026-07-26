import { memo } from 'react';
import { MusicIcon } from '../../core/components/Icons';
import { getImgReferrerPolicy } from '../../core/services/api';

interface CoverArtProps {
  src?: string;
  alt: string;
  className?: string;
  iconSize?: number;
}

/** 封面块。props 全是原始值，memo 可以直接切断父级高频重渲染。 */
function CoverArt({ src, alt, className = 'cover-art', iconSize = 42 }: CoverArtProps) {
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

export default memo(CoverArt);
