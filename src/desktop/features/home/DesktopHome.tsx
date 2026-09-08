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
import MotionPanel from '../../components/MotionPanel';
import type { DesktopView } from '../../types';
import { ContextSearchPanel, HomeHero, HomeSourceTabs } from './HomePanels';
import { attachContextSearchMeta, isCurrentContextSearch } from './contextSearch';
import { isBusyError } from './recommendationJobWatcher';
import { useRecommendationJob } from './useRecommendationJob';

const topListCache = new Map<string, { lists: TopList[]; ts: number }>();
const detailCache = new Map<string, { songs: Song[]; ts: number }>();
const cacheTtl = 3 * 60 * 1000;

interface DesktopHomeProps {
  onViewChange: (view: DesktopView) => void;
  onAiBusyChange: (busy: boolean) => void;
}

export default function DesktopHome({ onViewChange, onAiBusyChange }: DesktopHomeProps) {
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
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { favorites, playlists, toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();
  const isRecommendationSource = activeSource === 'recommendation';
  const recommendation = useRecommendationJob(isRecommendationSource, showToast);
  const featuredSongs = isRecommendationSource ? recommendation.songs : browseSongs;
  const loadingSongs = isRecommendationSource ? recommendation.loading : loadingBrowseSongs;
  const error = isRecommendationSource ? recommendation.error : browseError;
  const showResults = activeSource !== 'embeat' || loadingSongs || !!lastAiSearch;

  useEffect(() => {
    onAiBusyChange(activeSource === 'embeat' && loadingBrowseSongs);
    return () => onAiBusyChange(false);
  }, [activeSource, loadingBrowseSongs, onAiBusyChange]);

  const activeSourceLabel = useMemo(
    () => activeSource === 'recommendation'
      ? '为你推荐'
      : activeSource === 'embeat' ? 'AI 搜歌' : getMusicSourceLabel(activeSource),
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
    setBrowseError('');
    try {
      const songs = await getAIRecommendedSongs(cleanQuery, 'netease', 20, controller.signal);
      if (!isCurrentContextSearch(requestId, aiRequestIdRef.current, activeSourceRef.current)) return;
      const contextSongs = attachContextSearchMeta(songs, recommendationRequestId);
      setBrowseSongs(contextSongs);
      setLastAiSearch(cleanQuery);
      showToast(contextSongs.length === 0 ? '暂未找到符合意境的歌曲，换个词试试看' : `已生成 ${contextSongs.length} 首语境歌曲`, contextSongs.length === 0 ? 'info' : 'success');
    } catch (cause) {
      if (!isCurrentContextSearch(requestId, aiRequestIdRef.current, activeSourceRef.current)) return;
      console.error(cause);
      const message = cause instanceof Error && cause.message.includes('RATE_LIMIT')
        ? '语境搜歌请求过于频繁，请稍后再试。'
        : '语境搜歌服务当前不可用，请稍后再试。';
      setBrowseError(message);
    } finally {
      if (requestId === aiRequestIdRef.current) {
        aiAbortRef.current = null;
        setLoadingBrowseSongs(false);
      }
    }
  }, [showToast]);

  const cancelAiSearch = () => {
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setLoadingBrowseSongs(false);
  };

  const changeSource = (source: string) => {
    if (source === activeSourceRef.current) return;
    activeSourceRef.current = source;
    cancelAiSearch();
    requestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    setActiveSource(source);
    setBrowseSongs([]);
    setTopLists([]);
    setBrowseError('');
    setSelectedTopListId(null);
    setSelectedTopListName(source === 'recommendation' ? '智能推荐' : '');
    setLastAiSearch('');
    setLoadingLists(source !== 'recommendation' && source !== 'embeat');
  };

  const loadTopListDetail = useCallback(async (list: TopList, source = activeSource) => {
    const requestId = ++detailRequestIdRef.current;
    const key = `${source}:${list.id}`;
    setSelectedTopListId(key);
    setSelectedTopListName(list.name);
    setBrowseError('');
    const cached = detailCache.get(key);
    if (cached && Date.now() - cached.ts < cacheTtl) {
      setBrowseSongs(cached.songs);
      setLoadingBrowseSongs(false);
      return;
    }
    setLoadingBrowseSongs(true);
    try {
      const songs = await getTopListDetail(list.id, source);
      if (requestId !== detailRequestIdRef.current) return;
      detailCache.set(key, { songs, ts: Date.now() });
      setBrowseSongs(songs);
    } catch {
      if (requestId === detailRequestIdRef.current) {
        setBrowseSongs([]);
        setBrowseError('榜单歌曲暂时无法加载，请重新选择榜单或切换音源。');
      }
    } finally {
      if (requestId === detailRequestIdRef.current) setLoadingBrowseSongs(false);
    }
  }, [activeSource]);

  useEffect(() => {
    if (activeSource === 'recommendation' || activeSource === 'embeat') return;
    const requestId = ++requestIdRef.current;
    const cached = topListCache.get(activeSource);
    const request = cached && Date.now() - cached.ts < cacheTtl
      ? Promise.resolve(cached.lists) : getTopLists(activeSource);
    void request.then((lists) => {
      if (requestId !== requestIdRef.current) return;
      setTopLists(lists);
      topListCache.set(activeSource, { lists, ts: Date.now() });
    }).catch(() => {
      if (requestId !== requestIdRef.current) return;
      setBrowseError('该音源暂不可用，请切换其他音源。');
      setTopLists([]);
    }).finally(() => {
      if (requestId === requestIdRef.current) setLoadingLists(false);
    });
  }, [activeSource]);

  useEffect(() => () => {
    requestIdRef.current += 1;
    detailRequestIdRef.current += 1;
    aiRequestIdRef.current += 1;
    aiAbortRef.current?.abort();
  }, []);

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    if (!toggleFavorite(song)) return;
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
    }).catch((cause: unknown) => {
      if (isBusyError(cause)) showToast('推荐服务正在初始化，请稍后再试', 'info');
      else showToast('操作失败，请稍后再试', 'error');
    });
  };

  return (
    <div>
      <HomeHero
        greeting={greeting}
        favoritesCount={favorites.length}
        playlistsCount={playlists.filter((playlist) => playlist.id !== 'favorites').length}
        firstSong={featuredSongs[0]}
        selectionName={selectedTopListName}
        onPlay={handlePlay}
      />
      <HomeSourceTabs activeSource={activeSource} onChange={changeSource} />
      <MotionPanel transitionKey={`${activeSource}:${selectedTopListId ?? ''}`}>
      {isRecommendationSource && recommendation.initializing && (
        <div className="content-card home-status-card">
          <span className="home-status-text">推荐服务正在初始化，请稍候…</span>
        </div>
      )}
      {error && (
        <div className="content-card home-status-card">
          <span className="home-status-text"><ErrorIcon size={18} /> {error}</span>
          {isRecommendationSource && <button type="button" className="soft-button" onClick={() => onViewChange('settings')}>打开设置</button>}
        </div>
      )}
      {!isRecommendationSource && activeSource === 'embeat' ? (
        <ContextSearchPanel
          query={aiQuery}
          loading={loadingSongs}
          onQueryChange={setAiQuery}
          onSearch={handleAiSearch}
          onCancel={cancelAiSearch}
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
      {!isRecommendationSource && showResults && (
        <div className="section-header">
          <h2 className="section-title">
            {activeSource === 'embeat' ? (lastAiSearch ? `“${lastAiSearch}”` : '为你寻找音乐') : selectedTopListName || '榜单歌曲'}
          </h2>
          <span className="section-meta">{featuredSongs.length > 0 ? `${featuredSongs.length} 首歌曲` : activeSourceLabel}</span>
        </div>
      )}
      {showResults && (loadingSongs && featuredSongs.length === 0 ? (
        <SongTable songs={[]} isLoading skeletonRows={7} emptyText={isRecommendationSource ? '正在读取智能推荐...' : '正在分析语境...'} onPlay={handlePlay} />
      ) : featuredSongs.length === 0 ? (
        <div className="empty-state"><p>{isRecommendationSource ? '多听几首、收藏一些喜欢的歌，推荐会慢慢更懂你。也可以在设置中查看推荐是否已启用。' : activeSource === 'embeat' ? '暂时没有找到合适的歌曲，试着换一种描述。' : '选一张榜单，开始发现好音乐。'}</p></div>
      ) : (
        <SongTable songs={featuredSongs} currentSong={currentSong} isPlaying={isPlaying} emptyText="暂无榜单歌曲" onPlay={handlePlay} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} onDismiss={isRecommendationSource ? handleDismiss : undefined} />
      ))}
      </MotionPanel>
    </div>
  );
}
