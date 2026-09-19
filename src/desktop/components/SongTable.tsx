import { useEffect, useMemo, useRef, useState } from 'react';
import { MusicIcon } from '../../core/components/Icons';
import { Song, isSameSong } from '../../core/types';
import SongTableRow, { type SongRowDragHandlers, type SongRowHandlers, type SongRowSlots } from './SongTableRow';
import VirtualList from './VirtualList';

interface SongTableProps {
  songs: Song[];
  currentSong?: Song | null;
  isPlaying?: boolean;
  isLoading?: boolean;
  skeletonRows?: number;
  emptyText?: string;
  actionLabel?: string;
  onPlay: (song: Song) => void;
  onFavorite?: (song: Song) => void;
  isFavorite?: (song: Song) => boolean;
  onMore?: (song: Song) => void;
  onDismiss?: (song: Song) => void;
  onDelete?: (song: Song) => void;
  deleteLabel?: string;
  onEndReached?: () => void;
  /** 传入即开启拖拽排序（收藏与歌单详情用）。索引相对当前 `songs` 数组。 */
  onReorder?: (fromIndex: number, toIndex: number) => void;
}

export default function SongTable({
  songs,
  currentSong,
  isPlaying,
  isLoading = false,
  skeletonRows = 8,
  emptyText = '暂无歌曲',
  actionLabel = '播放',
  onPlay,
  onFavorite,
  isFavorite,
  onMore,
  onDismiss,
  onDelete,
  deleteLabel = '删除歌曲',
  onEndReached,
  onReorder,
}: SongTableProps) {
  // 调用方几乎都是就地箭头函数，直接下发会让行组件的 memo 永远失效；
  // 这里把最新实现存进 ref，对外只暴露一组永不变的转发函数。
  const latestRef = useRef({ onPlay, onFavorite, onMore, onDismiss, onDelete, onReorder });
  useEffect(() => {
    latestRef.current = { onPlay, onFavorite, onMore, onDismiss, onDelete, onReorder };
  });

  // 拖拽过程中的源行与落点行。只在松手时提交一次重排，途中不动真实数据，
  // 避免每次 dragover 都写一遍 localStorage。
  const dragOrigin = useRef<number | null>(null);
  const [dragState, setDragState] = useState<{ from: number; over: number } | null>(null);

  const handlers = useMemo<SongRowHandlers>(() => ({
    play: (song) => latestRef.current.onPlay(song),
    favorite: (song) => latestRef.current.onFavorite?.(song),
    more: (song) => latestRef.current.onMore?.(song),
    dismiss: (song) => latestRef.current.onDismiss?.(song),
    remove: (song) => latestRef.current.onDelete?.(song),
  }), []);

  const dragHandlers = useMemo<SongRowDragHandlers>(() => ({
    start: (index) => { dragOrigin.current = index; setDragState({ from: index, over: index }); },
    over: (index) => setDragState((current) =>
      !current || current.over === index ? current : { ...current, over: index }),
    drop: (from, to) => {
      setDragState(null);
      if (from === dragOrigin.current && from !== to) latestRef.current.onReorder?.(from, to);
      dragOrigin.current = null;
    },
    end: () => { dragOrigin.current = null; setDragState(null); },
    move: (index, offset) => latestRef.current.onReorder?.(index, index + offset),
  }), []);

  const hasFavorite = !!onFavorite;
  const hasMore = !!onMore;
  const hasDismiss = !!onDismiss;
  const hasDelete = !!onDelete;
  const slots = useMemo<SongRowSlots>(() => ({
    favorite: hasFavorite,
    more: hasMore,
    dismiss: hasDismiss,
    remove: hasDelete,
    removeLabel: deleteLabel,
  }), [deleteLabel, hasDelete, hasDismiss, hasFavorite, hasMore]);

  if (isLoading && songs.length === 0) {
    return (
      <div className="song-table skeleton-table" aria-busy="true" aria-label="歌曲加载中">
        <div className="table-head">
          <span>#</span>
          <span>歌曲</span>
          <span>专辑</span>
          <span>来源</span>
          <span>{actionLabel}</span>
        </div>
        {Array.from({ length: skeletonRows }).map((_, index) => (
          <div className="song-row skeleton-song-row" key={index}>
            <span className="skeleton-line skeleton-index" />
            <span className="song-main">
              <span className="song-cover skeleton-block" />
              <span className="song-info">
                <span className="skeleton-line skeleton-title" />
                <span className="skeleton-line skeleton-subtitle" />
              </span>
            </span>
            <span className="skeleton-line skeleton-album" />
            <span className="skeleton-pill" />
            <span className="table-actions">
              <span className="skeleton-dot" />
              <span className="skeleton-dot" />
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (songs.length === 0) {
    return (
      <div className="empty-state">
        <div>
          <MusicIcon size={46} />
          <p>{emptyText}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="song-table">
      <div className="table-head">
        <span>#</span>
        <span>歌曲</span>
        <span>专辑</span>
        <span>来源</span>
        <span>{actionLabel}</span>
      </div>
      <VirtualList
        items={songs}
        itemHeight={56}
        maxHeight={Math.min(640, Math.max(280, songs.length * 56))}
        className="song-virtual-list"
        onEndReached={onEndReached}
        getKey={(song, index) => `${song.source}-${song.id}-${index}`}
        renderItem={(song, index, style) => (
          <SongTableRow
            song={song}
            index={index}
            style={style}
            current={isSameSong(currentSong, song)}
            isPlaying={!!isPlaying}
            favoriteActive={Boolean(isFavorite?.(song))}
            handlers={handlers}
            slots={slots}
            drag={onReorder ? dragHandlers : undefined}
            dragging={dragState?.from === index}
            dropTarget={!!dragState && dragState.over === index && dragState.from !== index}
          />
        )}
      />
    </div>
  );
}
