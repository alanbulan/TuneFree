import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import { getTopLists, getTopListDetail } from '../services/api';
import { Song, TopList } from '../types';
import { usePlayer } from '../contexts/PlayerContext';
import { PlayIcon, MusicIcon, ErrorIcon } from '../components/Icons';

// ====== 数据缓存 — 切换音源时不重复请求 ======
const _topListCache = new Map<string, { lists: TopList[]; ts: number }>();
const _detailCache = new Map<string, { songs: Song[]; ts: number }>();
const CACHE_TTL = 3 * 60 * 1000; // 3 分钟

// ====== 记忆化歌曲卡片 — 避免列表滚动时重复渲染 ======
const SongCard = memo<{ song: Song; idx: number; onPlay: (s: Song) => void }>(({ song, idx, onPlay }) => {
    const songName = typeof song.name === 'string' ? song.name : '未知歌曲';
    const songArtist = typeof song.artist === 'string' ? song.artist : '未知歌手';

    return (
        <div
            className="flex items-center space-x-4 bg-white p-3 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] active:scale-[0.99] transition cursor-pointer"
            onClick={() => onPlay(song)}
        >
            <span className={`font-bold text-lg w-6 text-center italic ${idx < 3 ? 'text-ios-red' : 'text-ios-subtext/50'}`}>{idx + 1}</span>
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                {song.pic ? (
                    <img src={song.pic} alt={songName} referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <MusicIcon size={20} />
                    </div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-ios-text truncate text-[15px]">{songName}</p>
                <div className="flex items-center mt-1 space-x-2">
                    <span className="text-[10px] px-1 rounded bg-gray-100 text-gray-500 uppercase">{String(song.source)}</span>
                    <p className="text-xs text-ios-subtext truncate">{songArtist}</p>
                </div>
            </div>
            <button className="p-3 text-ios-red/80 hover:text-ios-red bg-gray-50 rounded-full">
                <PlayIcon size={18} className="fill-current ml-0.5" />
            </button>
        </div>
    );
});

// ====== 骨架屏组件 ======
const SongSkeleton = () => (
    <div className="flex items-center space-x-4 bg-white p-3 rounded-2xl animate-pulse">
        <div className="w-6 h-5 bg-gray-200 rounded" />
        <div className="w-12 h-12 rounded-lg bg-gray-200 flex-shrink-0" />
        <div className="flex-1 space-y-2">
            <div className="h-4 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
        </div>
    </div>
);

const TopListSkeleton = () => (
    <div className="flex gap-3 overflow-hidden pb-2">
        {[0,1,2,3].map(i => (
            <div key={i} className="flex-shrink-0 bg-white p-2 rounded-2xl min-w-[120px] max-w-[140px] animate-pulse">
                <div className="w-full aspect-square mb-2 rounded-xl bg-gray-200" />
                <div className="h-3.5 bg-gray-200 rounded mx-1 mb-1" />
                <div className="h-2.5 bg-gray-100 rounded mx-1 w-2/3" />
            </div>
        ))}
    </div>
);

const Home: React.FC = () => {
  const [topLists, setTopLists] = useState<TopList[]>([]);
  const [featuredSongs, setFeaturedSongs] = useState<Song[]>([]);
  const [listsLoading, setListsLoading] = useState(true);   // 仅榜单列表加载中
  const [songsLoading, setSongsLoading] = useState(true);    // 仅歌曲列表加载中
  const [error, setError] = useState(false);
  const [activeSource, setActiveSource] = useState('netease');
  const { playSong } = usePlayer();
  // 防止竞态：切换音源时旧请求覆盖新请求
  const fetchIdRef = useRef(0);

  const fetchLists = useCallback(async (source: string) => {
    const thisId = ++fetchIdRef.current;
    setError(false);

    // 检查缓存
    const cacheKey = source;
    const cached = _topListCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
        setTopLists(cached.lists);
        setListsLoading(false);
        // 榜单详情也检查缓存
        const detailKey = `${source}:${cached.lists[0]?.id}`;
        const cachedDetail = _detailCache.get(detailKey);
        if (cachedDetail && Date.now() - cachedDetail.ts < CACHE_TTL) {
            setFeaturedSongs(cachedDetail.songs);
            setSongsLoading(false);
            return;
        }
    } else {
        setListsLoading(true);
    }
    setSongsLoading(true);

    try {
        const lists = await getTopLists(source);
        if (thisId !== fetchIdRef.current) return; // 竞态检查
        if (lists && lists.length > 0) {
            setTopLists(lists);
            setListsLoading(false);
            _topListCache.set(cacheKey, { lists, ts: Date.now() });
            try {
                 const songs = await getTopListDetail(lists[0].id, source);
                 if (thisId !== fetchIdRef.current) return;
                 const sliced = songs.slice(0, 20);
                 setFeaturedSongs(sliced);
                 _detailCache.set(`${source}:${lists[0].id}`, { songs: sliced, ts: Date.now() });
            } catch (e) {
                 if (thisId === fetchIdRef.current) setFeaturedSongs([]);
            }
        } else {
            setTopLists([]);
            setFeaturedSongs([]);
            setError(true);
        }
    } catch (e) {
        if (thisId === fetchIdRef.current) {
            setTopLists([]);
            setFeaturedSongs([]);
            setError(true);
        }
    } finally {
        if (thisId === fetchIdRef.current) {
            setListsLoading(false);
            setSongsLoading(false);
        }
    }
  }, []);

  useEffect(() => {
    fetchLists(activeSource);
  }, [activeSource, fetchLists]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 5) return "夜深了";
    if (hour < 11) return "早上好";
    if (hour < 13) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  };

  const handleTopListClick = useCallback(async (list: TopList) => {
      // 检查缓存
      const detailKey = `${activeSource}:${list.id}`;
      const cached = _detailCache.get(detailKey);
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setFeaturedSongs(cached.songs);
          return;
      }

      setSongsLoading(true);
      try {
        const songs = await getTopListDetail(list.id, activeSource);
        const sliced = songs.slice(0, 20);
        setFeaturedSongs(sliced);
        _detailCache.set(detailKey, { songs: sliced, ts: Date.now() });
      } catch (e) {
        console.error("Failed to load list details", e);
      } finally {
        setSongsLoading(false);
      }
  }, [activeSource]);

  // 稳定引用的 playSong 回调
  const handlePlay = useCallback((song: Song) => {
    playSong(song);
  }, [playSong]);

  return (
    <div className="p-5 pt-safe min-h-screen bg-ios-bg">
      <div className="flex items-end justify-between mb-6 mt-2">
        <h1 className="text-3xl font-bold text-ios-text tracking-tight">{getGreeting()}</h1>
      </div>

      <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-ios-text">排行榜</h2>
            <div className="flex bg-gray-200/80 p-0.5 rounded-lg">
                {(['netease', 'qq', 'kuwo'] as const).map(src => (
                    <button
                        key={src}
                        onClick={() => setActiveSource(src)}
                        className={`px-3 py-1 text-[10px] font-bold uppercase rounded-md transition-all ${
                            activeSource === src
                            ? 'bg-white text-black shadow-sm'
                            : 'text-gray-500'
                        }`}
                    >
                        {src}
                    </button>
                ))}
            </div>
          </div>

          {listsLoading && topLists.length === 0 ? (
             <TopListSkeleton />
          ) : error ? (
              <div className="bg-red-50 p-4 rounded-xl flex items-center gap-3 text-red-600 mb-4">
                  <ErrorIcon size={20} />
                  <span className="text-xs font-medium">该音源暂不可用，请切换其他音源</span>
              </div>
          ) : (
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                  {topLists.map((list) => {
                      const cover = list.coverImgUrl || list.picUrl;
                      return (
                          <button
                            key={list.id}
                            onClick={() => handleTopListClick(list)}
                            className="flex-shrink-0 bg-white p-2 rounded-2xl shadow-sm border border-gray-100 min-w-[120px] max-w-[140px] text-left active:scale-95 transition"
                          >
                              <div className="w-full aspect-square mb-2 rounded-xl overflow-hidden bg-gray-100 relative">
                                    {cover ? (
                                        <img src={cover} alt={list.name} referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                                            <MusicIcon size={24} />
                                        </div>
                                    )}
                                    <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent pointer-events-none"></div>
                              </div>
                              <p className="font-bold text-ios-text text-sm truncate px-1">{String(list.name || '未知榜单')}</p>
                              <p className="text-[10px] text-ios-subtext mt-0.5 truncate px-1">{String(list.updateFrequency || '每日更新')}</p>
                          </button>
                      );
                  })}
              </div>
          )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-ios-text tracking-tight">榜单热歌</h2>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-1 rounded-full uppercase">{activeSource}</span>
        </div>

        {songsLoading && featuredSongs.length === 0 ? (
             <div className="space-y-3 pb-24">
                {[0,1,2,3,4].map(i => <SongSkeleton key={i} />)}
             </div>
        ) : featuredSongs.length > 0 ? (
            <div className="space-y-3 pb-24">
            {featuredSongs.map((song, idx) => (
                <SongCard key={`${song.id}-${idx}`} song={song} idx={idx} onPlay={handlePlay} />
            ))}
            </div>
        ) : (
            !songsLoading && (
                <div className="text-center py-10 text-gray-400 text-sm bg-white/50 rounded-xl">
                    <p>暂无歌曲数据</p>
                    <p className="text-xs mt-1">请尝试切换其他榜单或音源</p>
                </div>
            )
        )}
      </section>
    </div>
  );
};

export default Home;
