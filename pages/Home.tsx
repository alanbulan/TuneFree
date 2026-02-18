import React, { useEffect, useState, useCallback } from 'react';
import { getTopLists, getTopListDetail } from '../services/api';
import { Song, TopList } from '../types';
import { usePlayer } from '../contexts/PlayerContext';
import { PlayIcon, MusicIcon, ErrorIcon } from '../components/Icons';

const Home: React.FC = () => {
  const [topLists, setTopLists] = useState<TopList[]>([]);
  const [featuredSongs, setFeaturedSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeSource, setActiveSource] = useState('netease'); 
  const { playSong } = usePlayer();

  const fetchLists = useCallback(async (source: string) => {
    setLoading(true);
    setError(false);
    
    try {
        const lists = await getTopLists(source);
        if (lists && lists.length > 0) {
            setTopLists(lists);
            try {
                 const songs = await getTopListDetail(lists[0].id, source);
                 setFeaturedSongs(songs.slice(0, 20));
            } catch (e) {
                 setFeaturedSongs([]); 
            }
        } else {
            setTopLists([]);
            setFeaturedSongs([]);
            if (source === activeSource) setError(true);
        }
    } catch (e) {
        setTopLists([]);
        setFeaturedSongs([]);
        setError(true);
    } finally {
        setLoading(false);
    }
  }, [activeSource]);

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

  const handleTopListClick = async (list: TopList) => {
      setLoading(true);
      try {
        const songs = await getTopListDetail(list.id, activeSource);
        setFeaturedSongs(songs.slice(0, 20));
      } catch (e) {
        console.error("Failed to load list details", e);
      } finally {
        setLoading(false);
      }
  };

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

          {loading && topLists.length === 0 ? (
             <div className="h-24 flex items-center justify-center">
                 <div className="w-6 h-6 border-2 border-ios-red border-t-transparent rounded-full animate-spin"></div>
             </div>
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
                                        <img src={cover} alt={list.name} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
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

        {loading && featuredSongs.length === 0 ? (
             <div className="flex justify-center py-10">
                 <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-400 rounded-full animate-spin"></div>
             </div>
        ) : featuredSongs.length > 0 ? (
            <div className="space-y-3 pb-24">
            {featuredSongs.map((song, idx) => {
                const songName = typeof song.name === 'string' ? song.name : '未知歌曲';
                const songArtist = typeof song.artist === 'string' ? song.artist : '未知歌手';

                return (
                    <div 
                        key={`${song.id}-${idx}`} 
                        className="flex items-center space-x-4 bg-white p-3 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] active:scale-[0.99] transition cursor-pointer"
                        onClick={() => playSong(song)}
                    >
                    <span className={`font-bold text-lg w-6 text-center italic ${idx < 3 ? 'text-ios-red' : 'text-ios-subtext/50'}`}>{idx + 1}</span>
                    <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                        {song.pic ? (
                            <img src={song.pic} alt={songName} referrerPolicy="no-referrer" className="w-full h-full object-cover" />
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
            })}
            </div>
        ) : (
            !loading && (
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