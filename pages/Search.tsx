
import React, { useState, useEffect } from 'react';
import { searchAggregate, searchSongs } from '../services/api';
import { Song } from '../types';
import { usePlayer } from '../contexts/PlayerContext';
import { SearchIcon, MusicIcon, SettingsIcon } from '../components/Icons';

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

const Search: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'aggregate' | 'single'>('aggregate');
  const [selectedSource, setSelectedSource] = useState('netease');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  
  const debouncedQuery = useDebounce(query, 800);
  const { playSong, currentSong, isPlaying } = usePlayer();

  // Reset results when query or mode changes
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
                  // Endpoint #6 with page
                  data = await searchAggregate(debouncedQuery, page);
              } else {
                  // Endpoint #5 with page
                  data = await searchSongs(debouncedQuery, selectedSource, page);
              }
              
              if (data.length === 0) {
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

  const handleLoadMore = () => {
      if (!isSearching && hasMore) {
          setPage(prev => prev + 1);
      }
  };

  return (
    <div className="min-h-full p-5 pt-safe bg-ios-bg">
      <div className="sticky top-0 bg-ios-bg/95 backdrop-blur-md z-20 pb-2 transition-all">
        <h1 className="text-3xl font-bold mb-4 text-ios-text">搜索</h1>
        
        {/* Search Input */}
        <div className="relative shadow-sm rounded-xl mb-3">
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder={searchMode === 'aggregate' ? "聚合搜索全网资源..." : `搜索 ${selectedSource} 资源...`}
            className="w-full bg-white text-ios-text pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-ios-red/20 transition-all placeholder-gray-400 text-[15px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Search Mode Toggles */}
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
                        <option value="netease">网易云 (Netease)</option>
                        <option value="qq">QQ音乐 (QQ)</option>
                        <option value="kuwo">酷我 (Kuwo)</option>
                    </select>
                 </>
             )}
        </div>
      </div>

      <div className="space-y-2 mt-4 pb-20">
        {results.length > 0 && results.map((song, idx) => {
            const isCurrent = currentSong?.id === song.id;
            return (
                <div 
                    key={`${song.source}-${song.id}-${idx}`} 
                    className={`flex items-center space-x-3 p-3 rounded-xl transition cursor-pointer ${isCurrent ? 'bg-white shadow-sm ring-1 ring-ios-red/20' : 'hover:bg-white/50 active:bg-white'}`}
                    onClick={() => playSong(song)}
                >
                    <div className="relative w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100 flex items-center justify-center">
                        {song.pic ? (
                            <img src={song.pic} alt={song.name} className="w-full h-full object-cover" />
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
                        <p className={`font-medium truncate text-[15px] ${isCurrent ? 'text-ios-red' : 'text-ios-text'}`}>{song.name}</p>
                        <div className="flex items-center mt-0.5 space-x-2">
                            <span className={`text-[9px] px-1 rounded uppercase tracking-wider ${
                                song.source === 'netease' ? 'bg-red-100 text-red-600' :
                                song.source === 'qq' ? 'bg-green-100 text-green-600' :
                                song.source === 'kuwo' ? 'bg-yellow-100 text-yellow-700' : 
                                'bg-gray-200 text-gray-600'
                            }`}>{song.source}</span>
                            <p className="text-xs text-ios-subtext truncate">{song.artist}</p>
                        </div>
                    </div>
                </div>
            );
        })}

        {isSearching && (
           <div className="flex justify-center py-6">
              <div className="w-6 h-6 border-2 border-ios-red border-t-transparent rounded-full animate-spin"></div>
           </div>
        )}

        {!isSearching && results.length > 0 && hasMore && (
            <button 
                onClick={handleLoadMore}
                className="w-full py-4 text-sm text-ios-subtext font-medium active:bg-gray-100 rounded-xl transition"
            >
                加载更多
            </button>
        )}
        
        {!isSearching && results.length === 0 && query !== '' && (
             <div className="text-center py-10 text-gray-400 text-sm">
                未找到相关歌曲
             </div>
        )}
        
        {query === '' && (
            <div className="flex flex-col items-center justify-center pt-16 text-gray-400 space-y-4 opacity-60">
                <MusicIcon size={48} className="opacity-30" />
                <p className="text-sm">支持网易云、QQ、酷我</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default Search;
