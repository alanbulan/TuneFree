import { memo, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { HeartFillIcon, HeartIcon, MoreIcon, MusicIcon, PlayIcon, TrashIcon } from '../../core/components/Icons';
import { getImgReferrerPolicy } from '../../core/services/api';
import type { Song } from '../../core/types';
import { getMusicSourceLabel } from '../../core/utils/musicSource';

/** 行内操作回调，由 SongTable 用 ref 包成稳定引用后传下来，memo 才有意义。 */
export interface SongRowHandlers {
  play: (song: Song) => void;
  favorite: (song: Song) => void;
  more: (song: Song) => void;
  dismiss: (song: Song) => void;
  remove: (song: Song) => void;
}

/** 哪些行内按钮需要出现，同样必须是稳定引用。 */
export interface SongRowSlots {
  favorite: boolean;
  more: boolean;
  dismiss: boolean;
  remove: boolean;
  removeLabel: string;
}

interface SongTableRowProps {
  song: Song;
  index: number;
  style: CSSProperties;
  current: boolean;
  isPlaying: boolean;
  favoriteActive: boolean;
  handlers: SongRowHandlers;
  slots: SongRowSlots;
}

const stopRowActivation = (event: MouseEvent | KeyboardEvent) => event.stopPropagation();

/**
 * One song row.
 *
 * The row is a plain container rather than `role="button"`: it hosts several
 * real buttons, and nesting interactive roles makes screen readers announce the
 * whole row as a single control. Click / Enter / Space still start playback.
 */
function SongTableRow({
  song, index, style, current, isPlaying, favoriteActive, handlers, slots,
}: SongTableRowProps) {
  const title = typeof song.name === 'string' ? song.name : '未知歌曲';
  const artist = typeof song.artist === 'string' ? song.artist : '未知歌手';
  const album = typeof song.album === 'string' && song.album ? song.album : '未知专辑';
  const recommendationReason = song.recommendationReasons?.[0];

  return (
    <div
      className={`song-row ${current ? 'current' : ''}`}
      style={style}
      aria-label={`${title} - ${artist}`}
      aria-current={current ? 'true' : undefined}
      tabIndex={0}
      onClick={() => handlers.play(song)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handlers.play(song);
      }}
    >
      <span className="song-index">{current && isPlaying ? '▶' : String(index + 1).padStart(2, '0')}</span>
      <span className="song-main">
        <span className="song-cover">
          {song.pic ? (
            <img src={song.pic} alt="" referrerPolicy={getImgReferrerPolicy(song.pic)} loading="lazy" />
          ) : (
            <MusicIcon size={18} className="muted-text" />
          )}
        </span>
        <span className="song-info">
          <span className="song-title">{title}</span>
          <span className="song-artist">
            {recommendationReason ? `${artist} · ${recommendationReason}` : artist}
          </span>
        </span>
      </span>
      <span className="song-album">{album}</span>
      <span className="source-badge">{getMusicSourceLabel(song.source)}</span>
      <span className="table-actions" onClick={stopRowActivation} onKeyDown={stopRowActivation}>
        {slots.favorite && (
          <button
            type="button"
            className={`table-action ${favoriteActive ? 'active' : ''}`}
            aria-label={`${favoriteActive ? '取消收藏' : '收藏歌曲'} ${title}`}
            title={favoriteActive ? '取消收藏' : '收藏歌曲'}
            aria-pressed={favoriteActive}
            onClick={() => handlers.favorite(song)}
          >
            {favoriteActive ? <HeartFillIcon size={16} /> : <HeartIcon size={16} />}
          </button>
        )}
        <button type="button" className="table-action" aria-label={`立即播放 ${title}`} title="立即播放"
          onClick={() => handlers.play(song)}>
          <PlayIcon size={16} />
        </button>
        {slots.more && (
          <button type="button" className="table-action" aria-label={`更多操作 ${title}`} title="更多操作"
            onClick={() => handlers.more(song)}>
            <MoreIcon size={16} />
          </button>
        )}
        {slots.dismiss && (
          <button type="button" className="table-action table-action-danger" aria-label={`不感兴趣 ${title}`}
            title="不感兴趣" onClick={() => handlers.dismiss(song)}>
            <TrashIcon size={16} />
          </button>
        )}
        {slots.remove && (
          <button type="button" className="table-action table-action-danger"
            aria-label={`${slots.removeLabel} ${title}`} title={slots.removeLabel}
            onClick={() => handlers.remove(song)}>
            <TrashIcon size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

export default memo(SongTableRow);
