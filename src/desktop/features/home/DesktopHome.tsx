import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorIcon, MusicIcon, PlayIcon } from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { getImgReferrerPolicy, getTopListDetail, getTopLists } from '../../../core/services/api';
import type { Song, TopList } from '../../../core/types';
import { getMusicSourceLabel } from '../../../core/utils/musicSource';
import SongTable from '../../components/SongTable';
import { useToast } from '../../components/ToastHost';
import VirtualRail from '../../components/VirtualRail';
import type { DesktopView } from '../../types';

const topListCache = new Map<string, { lists: TopList[]; ts: number }>();
const detailCache = new Map<string, { songs: Song[]; ts: number }>();
const cacheTtl = 3 * 60 * 1000;

interface DesktopHomeProps {
  onViewChange: (view: DesktopView) => void;
}

export default function DesktopHome({ onViewChange }: DesktopHomeProps) {
  const [activeSource, setActiveSource] = useState('netease');
  const [topLists, setTopLists] = useState<TopList[]>([]);
  const [featuredSongs, setFeaturedSongs] = useState<Song[]>([]);
  const [selectedTopListId, setSelectedTopListId] = useState<string | null>(null);
  const [selectedTopListName, setSelectedTopListName] = useState('');
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const { playSong } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { favorites, playlists, toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 13) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }, []);

  const loadTopListDetail = useCallback(async (list: TopList, source = activeSource) => {
    const requestId = ++detailRequestIdRef.current;
    const key = `${source}:${list.id}`;
    setSelectedTopListId(key);
    setSelectedTopListName(list.name);
    const cached = detailCache.get(key);
    if (cached && Date.now() - cached.ts < cacheTtl) {
      setFeaturedSongs(cached.songs);
      return;
    }
    setLoadingSongs(true);
    try {
      const songs = await getTopListDetail(list.id, source);
      if (requestId !== detailRequestIdRef.current) return;
      detailCache.set(key, { songs, ts: Date.now() });
      setFeaturedSongs(songs);
    } catch {
      if (requestId !== detailRequestIdRef.current) return;
      setFeaturedSongs([]);
    } finally {
      if (requestId === detailRequestIdRef.current) setLoadingSongs(false);
    }
  }, [activeSource]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const load = async () => {
      setError('');
      setSelectedTopListId(null);
      setSelectedTopListName('');
      setLoadingLists(true);
      const cached = topListCache.get(activeSource);
      if (cached && Date.now() - cached.ts < cacheTtl) {
        setTopLists(cached.lists);
        setFeaturedSongs([]);
        setLoadingLists(false);
        return;
      }
      try {
        const lists = await getTopLists(activeSource);
        if (requestId !== requestIdRef.current) return;
        setTopLists(lists);
        setFeaturedSongs([]);
        topListCache.set(activeSource, { lists, ts: Date.now() });
      } catch {
        if (requestId !== requestIdRef.current) return;
        setError('该音源暂不可用，请切换其他音源。');
        setTopLists([]);
        setFeaturedSongs([]);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoadingLists(false);
        }
      }
    };
    load();
  }, [activeSource, loadTopListDetail]);

  const firstSong = featuredSongs[0];

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    toggleFavorite(song);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  return (
    <div>
      <section className="hero-grid">
        <div className="hero-card">
          <p className="eyebrow">by TuneFree</p>
          <h1 className="hero-title">{greeting}</h1>
          <div className="hero-nowline">
            <span>桌面音乐空间</span>
            <strong>{getMusicSourceLabel(activeSource)}</strong>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => firstSong && playSong(firstSong)}
              disabled={!firstSong}
              title={firstSong ? `播放 ${selectedTopListName || '当前榜单'}` : '先选择榜单'}
            >
              <PlayIcon size={15} /> {firstSong ? '播放榜单' : '先选择榜单'}
            </button>
            <button type="button" className="soft-button" onClick={() => onViewChange('search')}>搜索音乐</button>
          </div>
        </div>
        <div className="stat-card">
          <p className="eyebrow">Library</p>
          <strong>{favorites.length}</strong><span>收藏</span>
          <strong>{playlists.length}</strong><span>歌单</span>
        </div>
      </section>

      <div className="section-header">
        <h2 className="section-title">推荐榜单</h2>
        <div className="inline-actions">
          {['netease', 'qq', 'kuwo'].map((source) => (
            <button type="button" key={source} className={`source-chip ${activeSource === source ? 'active' : ''}`} onClick={() => setActiveSource(source)}>
              {getMusicSourceLabel(source)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="content-card"><ErrorIcon size={18} /> {error}</div>}

      {loadingLists && topLists.length === 0 ? (
        <div className="toplist-grid skeleton-rail" aria-busy="true" aria-label="榜单加载中">
          {Array.from({ length: 9 }).map((_, index) => (
            <div className="toplist-card skeleton-toplist-card" key={index}>
              <div className="cover-tile skeleton-block" />
              <span className="skeleton-line skeleton-card-title" />
              <span className="skeleton-line skeleton-card-subtitle" />
            </div>
          ))}
        </div>
      ) : (
        <VirtualRail
          items={topLists}
          itemWidth={164}
          itemHeight={236}
          className="toplist-grid"
          getKey={(list) => String(list.id)}
          renderItem={(list, _index, style) => {
            const cover = list.coverImgUrl || list.picUrl;
            return (
              <button
                type="button"
                className={`toplist-card ${selectedTopListId === `${activeSource}:${list.id}` ? 'active' : ''}`}
                style={style}
                aria-pressed={selectedTopListId === `${activeSource}:${list.id}`}
                onClick={() => loadTopListDetail(list)}
              >
                <div className="cover-tile">
                  {cover ? <img src={cover} alt={list.name} referrerPolicy={getImgReferrerPolicy(cover)} loading="lazy" /> : <MusicIcon size={28} />}
                </div>
                <h3>{list.name}</h3>
                <p>{list.updateFrequency || '每日更新'}</p>
              </button>
            );
          }}
        />
      )}

      <div className="section-header">
        <h2 className="section-title">{selectedTopListName ? `${selectedTopListName} · 热歌` : '榜单热歌'}</h2>
        <span className="source-badge">{getMusicSourceLabel(activeSource)}</span>
      </div>

      {loadingSongs && featuredSongs.length === 0 ? (
        <SongTable songs={[]} currentSong={currentSong} isPlaying={isPlaying} isLoading skeletonRows={7} emptyText="暂无榜单歌曲" onPlay={playSong} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} />
      ) : featuredSongs.length === 0 ? (
        <div className="empty-state"><p>选择上方任意榜单后，这里会加载完整热歌列表。</p></div>
      ) : (
        <SongTable songs={featuredSongs} currentSong={currentSong} isPlaying={isPlaying} emptyText="暂无榜单歌曲" onPlay={playSong} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} />
      )}
    </div>
  );
}
