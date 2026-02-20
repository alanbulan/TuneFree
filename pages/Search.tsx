import React, { useState, useEffect, memo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { searchAggregate, searchSongs } from '../services/api';
import { Song } from '../types';
import { usePlayer } from '../contexts/PlayerContext';
import { SearchIcon, MusicIcon, TrashIcon } from '../components/Icons';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// ====== 记忆化搜索结果卡片 ======
const SearchResultItem = memo<{
    song: Song;
    isCurrent: boolean;
    isPlaying: boolean;
    onPlay: (song: Song) => void;
}>(({ song, isCurrent, isPlaying, onPlay }) => {
    const songName = typeof song.name === 'string' ? song.name : '未知歌曲';
    const songArtist = typeof song.artist === 'string' ? song.artist : '未知歌手';

    return (
        <div
            className={`flex items-center space-x-3 p-3 rounded-xl transition cursor-pointer ${isCurrent ? 'bg-white shadow-sm ring-1 ring-ios-red/20' : 'hover:bg-white/50 active:bg-white'}`}
            onClick={() => onPlay(song)}
        >
            <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center">
                {song.pic ? (
                    <img src={song.pic} alt={songName} referrerPolicy="no-referrer" loading="lazy" className="w-full h-full object-cover" />
                ) : (
                    <MusicIcon className="text-gray-300" size={24} />
                )}
                {isCurrent && isPlaying && (
                     <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                         <div className="w-3 h-3 rounded-full bg-ios-red animate-pulse" />
                     </div>
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className={`font-medium truncate text-[15px] ${isCurrent ? 'text-ios-red' : 'text-ios-text'}`}>
                    {songName}
                </p>
                <div className="flex items-center mt-0.5 space-x-2">
                    <span className={`text-[9px] px-1 rounded uppercase tracking-wider ${
                        song.source === 'netease' ? 'bg-red-100 text-red-600' :
                        song.source === 'qq' ? 'bg-green-100 text-green-600' :
                        song.source === 'kuwo' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-gray-200 text-gray-600'
                    }`}>{String(song.source)}</span>
                    <p className="text-xs text-ios-subtext truncate">{songArtist}</p>
                </div>
            </div>
        </div>
    );
});

// ====== 搜索骨架屏 ======
const SearchSkeleton = () => (
    <div className="space-y-2">
        {[0,1,2,3,4,5].map(i => (
            <div key={i} className="flex items-center space-x-3 p-3 rounded-xl animate-pulse">
                <div className="w-12 h-12 rounded-lg bg-gray-200 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                    <div className="h-3 bg-gray-100 rounded w-1/3" />
                </div>
            </div>
        ))}
    </div>
);

const Search: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';

  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'aggregate' | 'single'>('aggregate');
  const [selectedSource, setSelectedSource] = useState('netease');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const [history, setHistory] = useState<string[]>(() => {
      try {
          const stored = localStorage.getItem('tunefree_search_history');
          return stored ? JSON.parse(stored) : [];
      } catch {
          return [];
      }
  });

  useEffect(() => {
      const q = searchParams.get('q');
      if (q !== null && q !== query) {
          setQuery(q);
      }
  }, [searchParams]);

  const debouncedQuery = useDebounce(query, 800);
  const { playSong, currentSong, isPlaying } = usePlayer();

  useEffect(() => {
      localStorage.setItem('tunefree_search_history', JSON.stringify(history));
  }, [history]);

  const addToHistory = useCallback((term: string) => {
      if (!term || typeof term !== 'string' || !term.trim()) return;
      setHistory(prev => {
          const newHist = [term, ...prev.filter(h => h !== term)].slice(0, 15);
          return newHist;
      });
  }, []);

  const clearHistory = useCallback(() => {
      if (confirm('确定要清空搜索历史吗？')) {
          setHistory([]);
      }
  }, []);

  useEffect(() => {
      setResults([]);
      setPage(1);
      setHasMore(true);
  }, [debouncedQuery, searchMode, selectedSource]);

  useEffect(() => {
    if (debouncedQuery) {
      setIsSearching(true);

      const fetchSearch = async () => {
          try {
              let data: Song[] = [];
              if (searchMode === 'aggregate') {
                  data = await searchAggregate(debouncedQuery, page);
              } else {
                  data = await searchSongs(debouncedQuery, selectedSource, page);
              }

              if (!data || data.length === 0) {
                  setHasMore(false);
              } else {
                  setResults(prev => page === 1 ? data : [...prev, ...data]);
              }
          } catch (e) {
              console.error(e);
              if (page === 1) setResults([]);
          } finally {
              setIsSearching(false);
          }
      };

      fetchSearch();
    }
  }, [debouncedQuery, searchMode, selectedSource, page]);

  const handleLoadMore = useCallback(() => {
      if (!isSearching && hasMore) {
          setPage(prev => prev + 1);
      }
  }, [isSearching, hasMore]);

  const handlePlaySong = useCallback((song: Song) => {
      addToHistory(query);
      playSong(song);
  }, [query, playSong, addToHistory]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          addToHistory(query);
          setSearchParams({ q: query });
          (e.target as HTMLInputElement).blur();
      }
  }, [query, addToHistory, setSearchParams]);

  const handleQueryChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
  }, []);

  return (
    <div className="min-h-full p-5 pt-safe bg-ios-bg">
      <div className="sticky top-0 bg-ios-bg/95 backdrop-blur-md z-20 pb-2 transition-all">
        <h1 className="text-3xl font-bold mb-4 text-ios-text">搜索</h1>

        <div className="relative shadow-sm rounded-xl mb-3">
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder={searchMode === 'aggregate' ? "全网聚合搜索 (已启用跨域代理)..." : `搜索 ${selectedSource} 资源...`}
            className="w-full bg-white text-ios-text pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-ios-red/20 transition-all placeholder-gray-400 text-[15px]"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar py-1">
             <button
                onClick={() => setSearchMode('aggregate')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                    searchMode === 'aggregate'
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
             >
                 聚合搜索
             </button>
             <button
                onClick={() => setSearchMode('single')}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                    searchMode === 'single'
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-600 border-gray-200'
                }`}
             >
                 指定源
             </button>

             {searchMode === 'single' && (
                 <>
                    <div className="w-px h-4 bg-gray-300 mx-2"></div>
                    <select
                        value={selectedSource}
                        onChange={(e) => setSelectedSource(e.target.value)}
                        className="bg-white border border-gray-200 text-xs font-medium px-3 py-1.5 rounded-full outline-none text-gray-700"
                    >
                        <option value="netease">网易云</option>
                        <option value="qq">QQ音乐</option>
                        <option value="kuwo">酷我音乐</option>
                    </select>
                 </>
             )}
        </div>
      </div>

      <div className="space-y-2 mt-4 pb-20">
        {!query && history.length > 0 && (
            <div className="mb-6">
                <div className="flex items-center justify-between mb-3 px-1">
                    <h3 className="font-bold text-gray-900 text-sm">搜索历史</h3>
                    <button onClick={clearHistory} className="text-gray-400 hover:text-red-500 p-1">
                        <TrashIcon size={16} />
                    </button>
                </div>
                <div className="flex flex-wrap gap-2">
                    {history.map((term, idx) => (
                        <button
                            key={idx}
                            onClick={() => {
                                setQuery(String(term));
                                setSearchParams({ q: String(term) });
                            }}
                            className="px-3 py-1.5 bg-white text-gray-600 text-xs rounded-lg border border-gray-100 active:bg-gray-100 transition truncate max-w-[150px]"
                        >
                            {String(term)}
                        </button>
                    ))}
                </div>
            </div>
        )}

        {results.length > 0 && results.map((song, idx) => (
            <SearchResultItem
                key={`${song.source}-${song.id}-${idx}`}
                song={song}
                isCurrent={currentSong?.id === song.id}
                isPlaying={isPlaying}
                onPlay={handlePlaySong}
            />
        ))}

        {isSearching && results.length === 0 && (
           <SearchSkeleton />
        )}

        {isSearching && results.length > 0 && (
           <div className="flex justify-center py-4">
              <div className="w-6 h-6 border-2 border-ios-red border-t-transparent rounded-full animate-spin"></div>
           </div>
        )}

        {!isSearching && results.length > 0 && hasMore && (
            <button
                onClick={handleLoadMore}
                className="w-full py-4 text-sm text-ios-subtext font-medium active:bg-gray-100 rounded-xl transition"
            >
                查看更多结果
            </button>
        )}

        {!isSearching && results.length === 0 && query !== '' && (
             <div className="text-center py-16 text-gray-400 text-sm">
                <MusicIcon size={48} className="mx-auto mb-4 opacity-10" />
                <p>未找到相关歌曲，请尝试简化关键词</p>
             </div>
        )}
      </div>
    </div>
  );
};

export default Search;
