import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ErrorIcon, MusicIcon, PlayIcon } from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { getImgReferrerPolicy, getTopListDetail, getTopLists } from '../../../core/services/api';
import { getAIRecommendedSongs } from '../../../core/services/gdStudio';
import {
  attachRecommendationMeta,
  dismissRecommendation,
  getRecommendationJob,
  logRecommendationEvent,
  recommendationFeedbackFromSong,
  saveRecommendationFeedback,
  startRecommendationJob,
} from '../../../core/services/recommendation';
import { updateRecommendationTaskProgress } from '../../../core/services/recommendationTaskProgress';
import type { Song, TopList } from '../../../core/types';
import { getMusicSourceLabel } from '../../../core/utils/musicSource';
import SongTable from '../../components/SongTable';
import { useToast } from '../../components/ToastHost';
import VirtualRail from '../../components/VirtualRail';
import type { DesktopView } from '../../types';

const topListCache = new Map<string, { lists: TopList[]; ts: number }>();
const detailCache = new Map<string, { songs: Song[]; ts: number }>();
const cacheTtl = 3 * 60 * 1000;
const recommendationJobPollMs = 1200;
const recommendationJobMaxPolls = 25;
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

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

  // 语境搜歌状态
  const [aiQuery, setAiQuery] = useState('');
  const [lastAiSearch, setLastAiSearch] = useState('');
  const requestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);
  const { playSong } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { favorites, playlists, toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();
  const isRecommendationSource = activeSource === 'recommendation';

  const activeSourceLabel = useMemo(() => {
    if (activeSource === 'recommendation') return '推荐';
    if (activeSource === 'embeat') return '语境搜歌';
    return getMusicSourceLabel(activeSource);
  }, [activeSource]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 5) return '夜深了';
    if (hour < 11) return '早上好';
    if (hour < 13) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }, []);

  const handleAiSearch = useCallback(async (query: string) => {
    if (!query.trim() || loadingSongs) return;
    setLoadingSongs(true);
    setLastAiSearch(query);
    setError('');
    try {
      const songs = await getAIRecommendedSongs(query, 'netease', 20);
      setFeaturedSongs(songs);
      if (songs.length === 0) {
        showToast('暂未找到符合意境的歌曲，换个词试试看', 'info');
      } else {
        showToast(`已生成 ${songs.length} 首语境歌曲`, 'success');
      }
    } catch (err: any) {
      console.error(err);
      setError('语境搜歌接口繁忙或超时，请稍后再试。');
      setFeaturedSongs([]);
    } finally {
      setLoadingSongs(false);
    }
  }, [loadingSongs, showToast]);

  const loadRecommendations = useCallback(async () => {
    const requestId = ++detailRequestIdRef.current;
    const startedAt = Date.now();
    setTopLists([]);
    setSelectedTopListId(null);
    setSelectedTopListName('为你推荐');
    setError('');
    setLoadingLists(false);
    setLoadingSongs(true);
    updateRecommendationTaskProgress({
      local: {
        label: '本地 worker',
        status: 'running',
        detail: '正在召回和排序推荐候选',
        updatedAt: startedAt,
      },
      cloud: {
        label: '云端 worker',
        status: 'idle',
        detail: '等待本地候选',
        updatedAt: startedAt,
      },
    });

    let keepLoadingForCloud = false;
    try {
      const job = await startRecommendationJob({ limit: 30, context: 'home' });
      if (requestId !== detailRequestIdRef.current) return;
      if (!job) {
        setFeaturedSongs([]);
        setError('推荐仅支持桌面端本地推荐数据库。');
        updateRecommendationTaskProgress({
          local: {
            status: 'error',
            detail: '桌面端推荐数据库不可用',
            updatedAt: Date.now(),
          },
          cloud: {
            status: 'disabled',
            detail: '当前环境不支持云端任务',
            updatedAt: Date.now(),
          },
        });
        return;
      }

      const hasInitialItems = job.items.length > 0;
      const isCloudRunning = job.status === 'running';
      keepLoadingForCloud = isCloudRunning && !hasInitialItems;
      setFeaturedSongs(attachRecommendationMeta(job.items));
      updateRecommendationTaskProgress({
        local: {
          status: 'done',
          detail: hasInitialItems ? `已生成 ${job.items.length} 首候选` : '本地候选为空，等待云端发现',
          updatedAt: Date.now(),
        },
        cloud: {
          status: job.stage === 'local_only' ? 'disabled' : job.status,
          detail: job.detail,
          updatedAt: Date.now(),
        },
      });
      if (!hasInitialItems && !isCloudRunning) {
        showToast('多播放或收藏几首歌后，推荐会更准确', 'info');
        return;
      }

      if (job.status === 'error') {
        if (job.error) showToast('云端发现与重排暂不可用，已保留当前推荐', 'warning');
        return;
      }
      if (job.status === 'done') return;

      void (async () => {
        try {
          for (let attempt = 0; attempt < recommendationJobMaxPolls; attempt += 1) {
            await wait(recommendationJobPollMs);
            if (requestId !== detailRequestIdRef.current) return;
            const nextJob = await getRecommendationJob(job.jobId);
            if (requestId !== detailRequestIdRef.current || !nextJob) return;
            updateRecommendationTaskProgress({
              cloud: {
                status: nextJob.status,
                detail: nextJob.detail,
                updatedAt: Date.now(),
              },
            });
            if (nextJob.status === 'done') {
              setFeaturedSongs(attachRecommendationMeta(nextJob.items));
              setLoadingSongs(false);
              updateRecommendationTaskProgress({
                cloud: {
                  status: 'done',
                  detail: `已刷新 ${nextJob.items.length} 首推荐`,
                  updatedAt: Date.now(),
                },
              });
              return;
            }
            if (nextJob.status === 'error') {
              if (nextJob.items.length > 0) {
                setFeaturedSongs(attachRecommendationMeta(nextJob.items));
              }
              setLoadingSongs(false);
              if (nextJob.error) showToast('云端发现与重排暂不可用，已保留当前推荐', 'warning');
              return;
            }
          }
          setLoadingSongs(false);
          updateRecommendationTaskProgress({
            cloud: {
              status: 'error',
              detail: '云端任务超时，保留当前推荐',
              updatedAt: Date.now(),
            },
          });
        } catch (err) {
          if (requestId !== detailRequestIdRef.current) return;
          console.error(err);
          setLoadingSongs(false);
          updateRecommendationTaskProgress({
            cloud: {
              status: 'error',
              detail: '云端任务查询失败，保留当前推荐',
              updatedAt: Date.now(),
            },
          });
          showToast('云端发现与重排暂不可用，已保留当前推荐', 'warning');
        }
      })();
    } catch (err) {
      if (requestId !== detailRequestIdRef.current) return;
      console.error(err);
      setFeaturedSongs([]);
      setError('推荐暂不可用。');
      updateRecommendationTaskProgress({
        local: {
          status: 'error',
          detail: '本地推荐任务失败',
          updatedAt: Date.now(),
        },
        cloud: {
          status: 'disabled',
          detail: '未启动云端任务',
          updatedAt: Date.now(),
        },
      });
    } finally {
      if (requestId === detailRequestIdRef.current && !keepLoadingForCloud) {
        setLoadingSongs(false);
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

      if (activeSource === 'recommendation') {
        await loadRecommendations();
        return;
      }

      if (activeSource === 'embeat') {
        setTopLists([]);
        setFeaturedSongs([]);
        setLoadingLists(false);
        return;
      }

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
  }, [activeSource, loadRecommendations, loadTopListDetail]);

  const firstSong = featuredSongs[0];

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    toggleFavorite(song);
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  const handleRecommendationPlay = (song: Song) => {
    const feedback = recommendationFeedbackFromSong(song, 'play');
    if (feedback) {
      void saveRecommendationFeedback(feedback).catch(() => {});
      void logRecommendationEvent({
        eventType: song.recommendationSource === 'hybrid' ? 'llm_recommend_click' : 'similar_click',
        song,
        context: song.recommendationSource || 'recommendation',
      }).catch(() => {});
    }
    void playSong(song);
  };

  const handleDismissRecommendation = (song: Song) => {
    void dismissRecommendation(song, 'not_interested')
      .then(() => {
        const feedback = recommendationFeedbackFromSong(song, 'dismiss');
        if (feedback) void saveRecommendationFeedback(feedback).catch(() => {});
        setFeaturedSongs((prev) => prev.filter((item) => !(item.id === song.id && item.source === song.source)));
        showToast('已减少类似推荐', 'success');
      })
      .catch(() => showToast('操作失败，请稍后再试', 'error'));
  };

  return (
    <div>
      <section className="hero-grid">
        <div className="hero-card">
          <p className="eyebrow">by TuneFree</p>
          <h1 className="hero-title">{greeting}</h1>
          <div className="hero-nowline">
            <span>桌面音乐空间</span>
            <strong>{activeSourceLabel}</strong>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="primary-button"
              onClick={() => firstSong && handleRecommendationPlay(firstSong)}
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
          {[
            { key: 'netease', label: getMusicSourceLabel('netease') },
            { key: 'qq', label: getMusicSourceLabel('qq') },
            { key: 'kuwo', label: getMusicSourceLabel('kuwo') },
            { key: 'recommendation', label: '推荐' },
            { key: 'embeat', label: '语境搜歌' },
          ].map((source) => (
            <button
              type="button"
              key={source.key}
              className={`source-chip ${activeSource === source.key ? 'active' : ''} ${source.key === 'embeat' ? 'ai-source-chip' : ''}`}
              onClick={() => setActiveSource(source.key)}
            >
              <span>{source.label}</span>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="content-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <ErrorIcon size={18} /> {error}
          </span>
          {activeSource === 'recommendation' && (
            <button type="button" className="soft-button" onClick={() => onViewChange('settings')}>
              打开设置
            </button>
          )}
        </div>
      )}

      {isRecommendationSource ? null : activeSource === 'embeat' ? (
        <div className="ai-rainbow-flow-border" style={{ margin: '8px 0 20px 0', padding: '22px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 900 }}>语境搜歌</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                  描述想听的音乐意境、情感或特定场景，生成更贴近当下语境的歌单。
                </p>
              </div>
              {currentSong && (
                <button
                  type="button"
                  className="ai-radar-btn"
                  onClick={() => handleAiSearch(`和 ${currentSong.name} - ${currentSong.artist} 意境相似的歌曲`)}
                >
                  <Sparkles size={13} style={{ marginRight: '5px' }} />
                  <span>开启相似音乐流</span>
                </button>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (aiQuery.trim()) handleAiSearch(aiQuery.trim());
              }}
              style={{ display: 'flex', gap: 10, width: '100%' }}
            >
              <input
                type="text"
                value={aiQuery}
                onChange={(e) => setAiQuery(e.target.value)}
                placeholder="Tell me what you want to hear... (例如：适合沉浸写代码的纯音乐)"
                style={{
                  flex: 1,
                  minHeight: '40px',
                  padding: '0 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-soft)',
                  background: 'var(--surface-soft)',
                  color: 'var(--text)',
                  fontSize: '13px',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                className="primary-button"
                style={{ minHeight: '40px', padding: '0 20px', borderRadius: '10px', fontWeight: 900 }}
                disabled={loadingSongs || !aiQuery.trim()}
              >
                {loadingSongs ? '分析中…' : '语境搜歌'}
              </button>
            </form>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 800 }}>推荐语境：</span>
              {[
                '下雨天的咖啡馆',
                '沉浸写代码',
                '晨起舒缓轻音乐',
                '燃脂电音运动风',
                '解压伤感民谣',
                '禅意冥想与空灵',
              ].map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => {
                    setAiQuery(tag);
                    handleAiSearch(tag);
                  }}
                  style={{
                    padding: '5px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-soft)',
                    background: 'var(--surface-soft)',
                    color: 'var(--text-soft)',
                    fontSize: '11px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.color = 'var(--text)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-soft)';
                    e.currentTarget.style.color = 'var(--text-soft)';
                  }}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        loadingLists && topLists.length === 0 ? (
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
        )
      )}

      <div className="section-header">
        <h2 className="section-title">
          {activeSource === 'embeat'
            ? (lastAiSearch ? `“${lastAiSearch}” 的语境歌单` : '语境搜歌歌单')
            : activeSource === 'recommendation'
              ? '为你推荐'
            : (selectedTopListName ? `${selectedTopListName} · 热歌` : '榜单热歌')
          }
        </h2>
        <span className="source-badge">
          {activeSourceLabel}
        </span>
      </div>

      {loadingSongs && featuredSongs.length === 0 ? (
        <SongTable songs={[]} currentSong={currentSong} isPlaying={isPlaying} isLoading skeletonRows={7} emptyText={isRecommendationSource ? '正在生成推荐...' : '正在分析语境...'} onPlay={handleRecommendationPlay} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} />
      ) : featuredSongs.length === 0 ? (
        <div className="empty-state">
          <p>
            {isRecommendationSource
              ? '多播放或收藏几首歌后，推荐会更准确。'
              : activeSource === 'embeat'
              ? '请在上方输入想听的内容，或者点击提示词开启语境音乐流。'
              : '选择上方任意榜单后，这里会加载完整热歌列表。'
            }
          </p>
        </div>
      ) : (
        <SongTable
          songs={featuredSongs}
          currentSong={currentSong}
          isPlaying={isPlaying}
          emptyText="暂无榜单歌曲"
          onPlay={handleRecommendationPlay}
          onFavorite={handleFavorite}
          isFavorite={(song) => isFavorite(song.id, song.source)}
          onDismiss={isRecommendationSource ? handleDismissRecommendation : undefined}
        />
      )}
    </div>
  );
}
