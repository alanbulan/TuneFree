import { memo, type CSSProperties, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { HeartFillIcon, HeartIcon, MoreIcon, MusicIcon, PlayIcon, TrashIcon } from '../../core/components/Icons';
import { getImgReferrerPolicy } from '../../core/services/api';
import type { Song } from '../../core/types';
import { getMusicSourceLabel } from '../../core/utils/musicSource';
import Tooltip from './Tooltip';

/** 行内操作回调，由 SongTable 用 ref 包成稳定引用后传下来，memo 才有意义。 */
export interface SongRowHandlers {
  play: (song: Song) => void;
  favorite: (song: Song) => void;
  more: (song: Song) => void;
  dismiss: (song: Song) => void;
  remove: (song: Song) => void;
}

/** 拖拽排序回调；不传即该列表不支持排序。 */
export interface SongRowDragHandlers {
  start: (index: number) => void;
  over: (index: number) => void;
  /** 松手：`fromIndex` 来自 dataTransfer，`toIndex` 是本行下标。 */
  drop: (fromIndex: number, toIndex: number) => void;
  end: () => void;
  /** 键盘排序：Alt+↑/↓ 把当前行上下移动一格。 */
  move: (index: number, offset: number) => void;
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
  drag?: SongRowDragHandlers;
  /** 正被拖动的行（半透明），以及当前落点行（显示插入指示线）。 */
  dragging?: boolean;
  dropTarget?: boolean;
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
  drag, dragging, dropTarget,
}: SongTableRowProps) {
  const title = typeof song.name === 'string' ? song.name : '未知歌曲';
  const artist = typeof song.artist === 'string' ? song.artist : '未知歌手';
  const album = typeof song.album === 'string' && song.album ? song.album : '未知专辑';
  const recommendationReason = song.recommendationReasons?.[0];

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!drag) return;
    // 必须写点数据，否则 Firefox 不会启动拖拽；同时声明为 move 让光标正确。
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    drag.start(index);
  };

  return (
    <div
      className={`song-row ${current ? 'current' : ''}${dragging ? ' is-dragging' : ''}${dropTarget ? ' is-drop-target' : ''}`}
      style={style}
      aria-label={`${title} - ${artist}`}
      aria-current={current ? 'true' : undefined}
      tabIndex={0}
      draggable={!!drag}
      onDragStart={handleDragStart}
      onDragOver={drag ? (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        drag.over(index);
      } : undefined}
      onDrop={drag ? (event) => {
        event.preventDefault();
        // 源下标从 dataTransfer 读回，这样 SongTable 不需要在渲染期持有拖拽状态。
        const raw = event.dataTransfer.getData('text/plain').trim();
        if (!raw) return;
        const from = Number(raw);
        drag.drop(Number.isInteger(from) ? from : index, index);
      } : undefined}
      onDragEnd={drag ? () => drag.end() : undefined}
      onClick={() => handlers.play(song)}
      onKeyDown={(event) => {
        // Alt+↑/↓ 给键盘用户一条与拖拽等价的排序路径。
        if (drag && event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
          event.preventDefault();
          drag.move(index, event.key === 'ArrowUp' ? -1 : 1);
          return;
        }
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
          <Tooltip label={favoriteActive ? '取消收藏' : '收藏歌曲'}>
            <button
              type="button"
              className={`table-action ${favoriteActive ? 'active' : ''}`}
              aria-label={`${favoriteActive ? '取消收藏' : '收藏歌曲'} ${title}`}
              aria-pressed={favoriteActive}
              onClick={() => handlers.favorite(song)}
            >
              {favoriteActive ? <HeartFillIcon size={16} /> : <HeartIcon size={16} />}
            </button>
          </Tooltip>
        )}
        <Tooltip label="立即播放">
          <button type="button" className="table-action" aria-label={`立即播放 ${title}`}
            onClick={() => handlers.play(song)}>
            <PlayIcon size={16} />
          </button>
        </Tooltip>
        {slots.more && (
          <Tooltip label="更多操作">
            <button type="button" className="table-action" aria-label={`更多操作 ${title}`}
              onClick={() => handlers.more(song)}>
              <MoreIcon size={16} />
            </button>
          </Tooltip>
        )}
        {slots.dismiss && (
          <Tooltip label="不感兴趣">
            <button type="button" className="table-action table-action-danger" aria-label={`不感兴趣 ${title}`}
              onClick={() => handlers.dismiss(song)}>
              <TrashIcon size={16} />
            </button>
          </Tooltip>
        )}
        {slots.remove && (
          <Tooltip label={slots.removeLabel}>
            <button type="button" className="table-action table-action-danger"
              aria-label={`${slots.removeLabel} ${title}`}
              onClick={() => handlers.remove(song)}>
              <TrashIcon size={16} />
            </button>
          </Tooltip>
        )}
      </span>
    </div>
  );
}

export default memo(SongTableRow);
