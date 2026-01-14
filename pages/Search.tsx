import React, { useState, useEffect } from 'react';
import { searchAggregate } from '../services/api';
import { Song } from '../types';
import { usePlayer } from '../contexts/PlayerContext';
import { SearchIcon, PlayIcon, MusicIcon } from '../components/Icons';

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
  const debouncedQuery = useDebounce(query, 800); // Increased debounce for aggregate search
  const { playSong, currentSong, isPlaying } = usePlayer();

  useEffect(() => {
    if (debouncedQuery) {
      setIsSearching(true);
      // Use Aggregate Search (#6)
      searchAggregate(debouncedQuery).then(data => {
        setResults(data);
        setIsSearching(false);
      });
    } else {
      setResults([]);
    }
  }, [debouncedQuery]);

  return (
    <div className="min-h-full p-5 pt-safe bg-ios-bg">
      <div className="sticky top-0 bg-ios-bg/95 backdrop-blur-md z-20 pb-2">
        <h1 className="text-3xl font-bold mb-4 text-ios-text">聚合搜索</h1>
        <div className="relative shadow-sm rounded-xl">
          <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="搜索歌曲、歌手 (网易/酷我/QQ)..."
            className="w-full bg-white text-ios-text pl-10 pr-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-ios-red/20 transition-all placeholder-gray-400 text-[15px]"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2 mt-4 pb-20">
        {isSearching ? (
           <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-4 border-ios-red border-t-transparent rounded-full animate-spin"></div>
           </div>
        ) : results.length > 0 ? (
          results.map((song, idx) => {
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
                                song.source === 'kuwo' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-200 text-gray-600'
                            }`}>{song.source}</span>
                            <p className="text-xs text-ios-subtext truncate">{song.artist}</p>
                        </div>
                    </div>
                </div>
            );
          })
        ) : (
            query !== '' && (
                 <div className="text-center py-10 text-gray-400 text-sm">
                    未找到相关歌曲
                 </div>
            )
        )}
        
        {query === '' && (
            <div className="flex flex-col items-center justify-center pt-24 text-gray-400 space-y-4">
                <MusicIcon size={48} className="opacity-30" />
                <p className="text-sm">探索全网海量音乐资源</p>
            </div>
        )}
      </div>
    </div>
  );
};

export default Search;