import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ErrorIcon, MusicIcon } from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { getImgReferrerPolicy, getTopListDetail, getTopLists } from '../../../core/services/api';
import { getAIRecommendedSongs } from '../../../core/services/gdStudio';
import { recommendationFeedbackFromSong, saveRecommendationFeedback } from '../../../core/services/recommendation';
import type { Song, TopList } from '../../../core/types';
import { getMusicSourceLabel } from '../../../core/utils/musicSource';
import SongTable from '../../components/SongTable';
import { useToast } from '../../components/ToastHost';
import VirtualRail from '../../components/VirtualRail';
import type { DesktopView } from '../../types';
import { ContextSearchPanel, HomeHero, HomeSourceTabs } from './HomePanels';
import { attachContextSearchMeta, isCurrentContextSearch } from './contextSearch';
import { useRecommendationJob } from './useRecommendationJob';

const topListCache = new Map<string, { lists: TopList[]; ts: number }>();
const detailCache = new Map<string, { songs: Song[]; ts: number }>();
const cacheTtl = 3 * 60 * 1000;

interface DesktopHomeProps {
  onViewChange: (view: DesktopView) => void;
}

export default function DesktopHome({ onViewChange }: DesktopHomeProps) {
  const [activeSource, setActiveSource] = useState('netease');
  const [topLists, setTopLists] = useState<TopList[]>([]);
  const [browseSongs, setBrowseSongs] = useState<Song[]>([]);
  const [selectedTopListId, setSelectedTopListId] = useState<string | null>(null);
  const [selectedTopListName, setSelectedTopListName] = useState('');
  const [loadingLists, setLoadingLists] = useState(true);
  const [loadingBrowseSongs, setLoadingBrowseSongs] = useState(false);
  const [browseError, setBrowseError] = useState('');
  const [aiQuery, setAiQuery] = useState('');
  const [lastAiSearch, setLastAiSearch] = useState('');
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const aiRequestIdRef = useRef(0);
  const aiAbortRef = useRef<AbortController | null>(null);
  const activeSourceRef = useRef(activeSource);
  activeSourceRef.current = activeSource;
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { favorites, playlists, toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();
  const isRecommendationSource = activeSource === 'recommendation';
  const recommendation = useRecommendationJob(isRecommendationSource, showToast);
  const featuredSongs = isRecommendationSource ? recommendation.songs : browseSongs;
  const loadingSongs = isRecommendationSource ? recommendation.loading : loadingBrowseSongs;
  const error = isRecommendationSource ? recommendation.error : browseError;

  const activeSourceLabel = useMemo(
    () => activeSource === 'recommendation'
      ? '智能推荐'
      : activeSource === 'embeat' ? '语境搜歌' : getMusicSourceLabel(activeSource),
    [activeSource],
  );
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 13) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }, []);

  const handleAiSearch = useCallback(async (query: string) => {
    const cleanQuery = query.trim();
    if (!cleanQuery) return;
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;
    const requestId = ++aiRequestIdRef.current;
    const recommendationRequestId = `embeat:${Date.now()}:${requestId}`;
    setLoadingBrowseSongs(true);
    setLastAiSearch(cleanQuery);
    setBrowseError('');
    try {
      const songs = await getAIRecommendedSongs(cleanQuery, 'netease', 20, controller.signal);
      if (!isCurrentContextSearch(requestId, aiRequestIdRef.current, activeSourceRef.current)) return;
      const contextSongs = attachContextSearchMeta(songs, recommendationRequestId);
      setBrowseSongs(contextSongs);
      showToast(contextSongs.length === 0 ? '暂未找到符合意境的歌曲，换个词试试看' : `已生成 ${contextSongs.length} 首语境歌曲`, contextSongs.length === 0 ? 'info' : 'success');
    } catch (cause) {
      if (!isCurrentContextSearch(requestId, aiRequestIdRef.current, activeSourceRef.current)) return;
      console.error(cause);
      const message = cause instanceof Error && cause.message.includes('RATE_LIMIT')
        ? '语境搜歌请求过于频繁，请稍后再试。'
        : '语境搜歌服务当前不可用，请稍后再试。';
      setBrowseError(message);
      setBrowseSongs([]);
    } finally {
      if (requestId === aiRequestIdRef.current) {
        aiAbortRef.current = null;
        setLoadingBrowseSongs(false);
      }
    }
  }, [showToast]);

  const loadTopListDetail = useCallback(async (list: TopList, source = activeSource) => {
    const requestId = ++detailRequestIdRef.current;
    const key = `${source}:${list.id}`;
    setSelectedTopListId(key);
    setSelectedTopListName(list.name);
    const cached = detailCache.get(key);
    if (cached && Date.now() - cached.ts < cacheTtl) {
      setBrowseSongs(cached.songs);
      return;
    }
    setLoadingBrowseSongs(true);
    try {
      const songs = await getTopListDetail(list.id, source);
      if (requestId !== detailRequestIdRef.current) return;
      detailCache.set(key, { songs, ts: Date.now() });
      setBrowseSongs(songs);
    } catch {
      if (requestId === detailRequestIdRef.current) setBrowseSongs([]);
    } finally {
      if (requestId === detailRequestIdRef.current) setLoadingBrowseSongs(false);
    }
  }, [activeSource]);

  useEffect(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    aiRequestIdRef.current += 1;
    setLoadingBrowseSongs(false);
    const requestId = ++requestIdRef.current;
    setBrowseError('');
    setSelectedTopListId(null);
    setSelectedTopListName(activeSource === 'recommendation' ? '智能推荐' : '');
    if (activeSource === 'recommendation') {
      setTopLists([]);
      setLoadingLists(false);
      return;
    }
    if (activeSource === 'embeat') {
      setTopLists([]);
      setBrowseSongs([]);
      setLoadingLists(false);
      return;
    }
    setLoadingLists(true);
    const cached = topListCache.get(activeSource);
    if (cached && Date.now() - cached.ts < cacheTtl) {
      setTopLists(cached.lists);
      setBrowseSongs([]);
      setLoadingLists(false);
      return;
    }
    void getTopLists(activeSource).then((lists) => {
      if (requestId !== requestIdRef.current) return;
      setTopLists(lists);
      setBrowseSongs([]);
      topListCache.set(activeSource, { lists, ts: Date.now() });
    }).catch(() => {
      if (requestId !== requestIdRef.current) return;
      setBrowseError('该音源暂不可用，请切换其他音源。');
      setTopLists([]);
      setBrowseSongs([]);
    }).finally(() => {
      if (requestId === requestIdRef.current) setLoadingLists(false);
    });
  }, [activeSource]);

  useEffect(() => () => {
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
  }, []);

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    toggleFavorite(song);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销', onClick: () => toggleFavorite(song),
    });
  };
  const handlePlay = (song: Song) => {
    const feedback = recommendationFeedbackFromSong(song, 'play', 'home');
    if (feedback) void saveRecommendationFeedback(feedback).catch(() => {});
    void playQueue(featuredSongs, song);
  };
  const handleDismiss = (song: Song) => {
    const feedback = recommendationFeedbackFromSong(song, 'dismiss', 'home');
    if (!feedback) return;
    void saveRecommendationFeedback(feedback).then(() => {
      recommendation.removeSong(song);
      showToast('已减少类似推荐', 'success');
    }).catch(() => showToast('操作失败，请稍后再试', 'error'));
  };

  return (
    <div>
      <HomeHero
        greeting={greeting}
        sourceLabel={activeSourceLabel}
        favoritesCount={favorites.length}
        playlistsCount={playlists.length}
        firstSong={featuredSongs[0]}
        selectionName={selectedTopListName}
        onPlay={handlePlay}
        onSearch={() => onViewChange('search')}
      />
      <HomeSourceTabs activeSource={activeSource} onChange={setActiveSource} />
      {error && (
        <div className="content-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><ErrorIcon size={18} /> {error}</span>
          {isRecommendationSource && <button type="button" className="soft-button" onClick={() => onViewChange('settings')}>打开设置</button>}
        </div>
      )}
      {!isRecommendationSource && activeSource === 'embeat' ? (
        <ContextSearchPanel
          query={aiQuery}
          loading={loadingSongs}
          currentSong={currentSong}
          onQueryChange={setAiQuery}
          onSearch={handleAiSearch}
        />
      ) : !isRecommendationSource && (loadingLists && topLists.length === 0 ? (
        <div className="toplist-grid skeleton-rail" aria-busy="true" aria-label="榜单加载中">
          {Array.from({ length: 9 }).map((_, index) => (
            <div className="toplist-card skeleton-toplist-card" key={index}>
              <div className="cover-tile skeleton-block" /><span className="skeleton-line skeleton-card-title" /><span className="skeleton-line skeleton-card-subtitle" />
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
              <button type="button" className={`toplist-card ${selectedTopListId === `${activeSource}:${list.id}` ? 'active' : ''}`} style={style} aria-pressed={selectedTopListId === `${activeSource}:${list.id}`} onClick={() => loadTopListDetail(list)}>
                <div className="cover-tile">{cover ? <img src={cover} alt={list.name} referrerPolicy={getImgReferrerPolicy(cover)} loading="lazy" /> : <MusicIcon size={28} />}</div>
                <h3>{list.name}</h3><p>{list.updateFrequency || '每日更新'}</p>
              </button>
            );
          }}
        />
      ))}
      {!isRecommendationSource && (
        <div className="section-header">
          <h2 className="section-title">
            {activeSource === 'embeat' ? (lastAiSearch ? `“${lastAiSearch}” 的语境歌单` : '语境搜歌歌单') : selectedTopListName ? `${selectedTopListName} · 热歌` : '榜单热歌'}
          </h2>
          <span className="source-badge">{activeSourceLabel}</span>
        </div>
      )}
      {loadingSongs && featuredSongs.length === 0 ? (
        <SongTable songs={[]} currentSong={currentSong} isPlaying={isPlaying} isLoading skeletonRows={7} emptyText={isRecommendationSource ? '正在读取智能推荐...' : '正在分析语境...'} onPlay={handlePlay} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} />
      ) : featuredSongs.length === 0 ? (
        <div className="empty-state"><p>{isRecommendationSource ? '智能推荐还没有准备好，请多播放或收藏几首歌，或确认设置中已启用推荐。' : activeSource === 'embeat' ? '请在上方输入想听的内容，或者点击提示词开启语境音乐流。' : '选择上方任意榜单后，这里会加载完整热歌列表。'}</p></div>
      ) : (
        <SongTable songs={featuredSongs} currentSong={currentSong} isPlaying={isPlaying} emptyText="暂无榜单歌曲" onPlay={handlePlay} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} onDismiss={isRecommendationSource ? handleDismiss : undefined} />
      )}
    </div>
  );
}
