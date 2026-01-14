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
  // Track which source is currently active for the displayed lists
  const [activeSource, setActiveSource] = useState('netease'); 
  const { playSong } = usePlayer();

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(false);
    
    // Fallback strategy: Try sources in order until one works
    const sources = ['netease', 'kuwo', 'qq'];
    let success = false;

    for (const source of sources) {
        try {
            const lists = await getTopLists(source);
            if (lists && lists.length > 0) {
                setTopLists(lists);
                setActiveSource(source);
                
                // Attempt to fetch first list details
                try {
                     const songs = await getTopListDetail(lists[0].id, source);
                     setFeaturedSongs(songs.slice(0, 20));
                } catch (e) {
                     console.warn(`Failed to load details for ${source} list`, e);
                     setFeaturedSongs([]); // Keep empty if fails, but don't fail the whole page
                }
                
                success = true;
                break; // Found working source, stop trying
            }
        } catch (e) {
            console.warn(`Source ${source} failed to load`, e);
        }
    }

    if (!success) {
        setError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        // Use the active source that was found to be working
        const songs = await getTopListDetail(list.id, activeSource);
        setFeaturedSongs(songs.slice(0, 20));
      } catch (e) {
        console.error("Failed to load list details", e);
      } finally {
        setLoading(false);
      }
  };

  if (loading && topLists.length === 0) {
      return (
          <div className="flex items-center justify-center h-full pt-safe">
              <div className="w-8 h-8 border-4 border-ios-red border-t-transparent rounded-full animate-spin"></div>
          </div>
      );
  }

  if (error && topLists.length === 0) {
      return (
          <div className="flex flex-col items-center justify-center h-full pt-safe px-6 text-center">
              <div className="bg-red-50 p-4 rounded-full mb-4">
                  <ErrorIcon className="text-red-500" size={32} />
              </div>
              <h2 className="text-lg font-bold text-gray-800 mb-2">加载失败</h2>
              <p className="text-gray-500 text-sm mb-6">无法连接到音乐服务。这可能是由于网络限制或服务器维护。</p>
              <button 
                onClick={fetchData}
                className="px-6 py-2.5 bg-ios-text text-white rounded-full font-medium active:scale-95 transition-transform"
              >
                重试
              </button>
          </div>
      );
  }

  return (
    <div className="p-5 pt-safe min-h-screen bg-ios-bg">
      <div className="flex items-end justify-between mb-6 mt-2">
        <h1 className="text-3xl font-bold text-ios-text tracking-tight">{getGreeting()}</h1>
        <span className="text-xs text-ios-red font-medium bg-ios-red/10 px-3 py-1 rounded-full">热歌榜单</span>
      </div>
      
      {/* Top Lists Horizontal Scroll */}
      <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-ios-text">排行榜</h2>
            <span className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded uppercase">{activeSource}</span>
          </div>
          <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
              {topLists.map((list) => (
                  <button 
                    key={list.id}
                    onClick={() => handleTopListClick(list)}
                    className="flex-shrink-0 bg-white p-3 rounded-xl shadow-sm border border-gray-100 min-w-[120px] text-left active:scale-95 transition"
                  >
                      <p className="font-bold text-ios-text text-sm truncate">{list.name}</p>
                      <p className="text-xs text-ios-subtext mt-1">{list.updateFrequency}</p>
                  </button>
              ))}
          </div>
      </section>

      <section>
        <h2 className="text-xl font-bold mb-4 text-ios-text tracking-tight">热门歌曲</h2>
        {featuredSongs.length > 0 ? (
            <div className="space-y-3 pb-24">
            {featuredSongs.map((song, idx) => (
                <div 
                    key={`${song.id}-${idx}`} 
                    className="flex items-center space-x-4 bg-white p-3 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.02)] active:scale-[0.99] transition cursor-pointer"
                    onClick={() => playSong(song)}
                >
                <span className={`font-bold text-lg w-6 text-center italic ${idx < 3 ? 'text-ios-red' : 'text-ios-subtext/50'}`}>{idx + 1}</span>
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                    {song.pic ? (
                        <img src={song.pic} alt={song.name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                            <MusicIcon size={20} />
                        </div>
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ios-text truncate text-[15px]">{song.name}</p>
                    <div className="flex items-center mt-1 space-x-2">
                        <span className="text-[10px] px-1 rounded bg-gray-100 text-gray-500 uppercase">{song.source}</span>
                        <p className="text-xs text-ios-subtext truncate">{song.artist}</p>
                    </div>
                </div>
                <button className="p-3 text-ios-red/80 hover:text-ios-red bg-gray-50 rounded-full">
                    <PlayIcon size={18} className="fill-current ml-0.5" />
                </button>
                </div>
            ))}
            </div>
        ) : (
            <div className="text-center py-10 text-gray-400">
                <p>暂无歌曲数据</p>
            </div>
        )}
      </section>
    </div>
  );
};

export default Home;