import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ErrorIcon, MusicIcon, PlayIcon } from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { getImgReferrerPolicy, getTopListDetail, getTopLists } from '../../../core/services/api';
import { getAIRecommendedSongs, resolveAutosource } from '../../../core/services/gdStudio';
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

  // AI 智能推荐状态
  const [aiQuery, setAiQuery] = useState('');
  const [lastAiSearch, setLastAiSearch] = useState('');
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

  const handleAiSearch = useCallback(async (query: string) => {
    if (!query.trim() || loadingSongs) return;
    setLoadingSongs(true);
    setLastAiSearch(query);
    setError('');
    try {
      const songs = await getAIRecommendedSongs(query, 'netease', 20);
      setFeaturedSongs(songs);
      if (songs.length === 0) {
        showToast('AI 未能找到符合意境的歌曲，换个词试试看', 'info');
      } else {
        showToast(`AI 精心推荐了 ${songs.length} 首歌曲`, 'success');

        // 异步在后台使用 autosource 接口为每首 embeat 歌曲获取真实封面
        songs.forEach((song, index) => {
          if (!song.pic) {
            resolveAutosource({
              name: song.name || '',
              artist: song.artist || '',
              album: song.album || '',
              source: song.source || 'embeat',
            }).then((result) => {
              if (result?.pic) {
                setFeaturedSongs((prev) => {
                  const updated = [...prev];
                  if (updated[index] && updated[index].id === song.id) {
                    updated[index] = { ...updated[index], pic: result.pic };
                  }
                  return updated;
                });
              }
            });
          }
        });
      }
    } catch (err: any) {
      console.error(err);
      setError('AI 搜歌接口繁忙或超时，请稍后再试。');
      setFeaturedSongs([]);
    } finally {
      setLoadingSongs(false);
    }
  }, [loadingSongs, showToast]);

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
          {['netease', 'qq', 'kuwo', 'embeat'].map((source) => (
            <button
              type="button"
              key={source}
              className={`source-chip ${activeSource === source ? 'active' : ''} ${source === 'embeat' ? 'ai-source-chip' : ''}`}
              onClick={() => setActiveSource(source)}
            >
              <span>{source === 'embeat' ? 'AI 推荐' : getMusicSourceLabel(source)}</span>
            </button>
          ))}
        </div>
      </div>

      {error && <div className="content-card"><ErrorIcon size={18} /> {error}</div>}

      {activeSource === 'embeat' ? (
        <div className="ai-rainbow-flow-border" style={{ margin: '8px 0 20px 0', padding: '22px 20px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 900 }}>AI 音乐助理</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--muted)' }}>
                  描述您想听的音乐意境、情感或特定场景，由 AI 为您量身推荐歌单。
                </p>
              </div>

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
                className="ai-radar-btn"
                style={{
                  minHeight: '40px',
                  padding: '0 20px',
                  borderRadius: '10px',
                  fontWeight: 900,
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
                disabled={loadingSongs || !aiQuery.trim()}
              >
                <Sparkles size={14} />
                <span>{loadingSongs ? '分析中…' : 'AI 搜歌'}</span>
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
            ? (lastAiSearch ? `“${lastAiSearch}” 的 AI 推荐歌单` : 'AI 推荐歌单')
            : (selectedTopListName ? `${selectedTopListName} · 热歌` : '榜单热歌')
          }
        </h2>
        <span className="source-badge">
          {activeSource === 'embeat' ? 'AI 推荐' : getMusicSourceLabel(activeSource)}
        </span>
      </div>

      {loadingSongs && featuredSongs.length === 0 ? (
        <SongTable songs={[]} currentSong={currentSong} isPlaying={isPlaying} isLoading skeletonRows={7} emptyText="AI 正在深度意境分析中..." onPlay={playSong} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} />
      ) : featuredSongs.length === 0 ? (
        <div className="empty-state">
          <p>
            {activeSource === 'embeat'
              ? '请在上方输入想听的内容，或者点击提示词开启 AI 音乐心流之旅。'
              : '选择上方任意榜单后，这里会加载完整热歌列表。'
            }
          </p>
        </div>
      ) : (
        <SongTable songs={featuredSongs} currentSong={currentSong} isPlaying={isPlaying} emptyText="暂无榜单歌曲" onPlay={playSong} onFavorite={handleFavorite} isFavorite={(song) => isFavorite(song.id, song.source)} />
      )}
    </div>
  );
}
