import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MusicIcon, SearchIcon } from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { isGDStudioOnlySource, searchAggregate, searchSongs } from '../../../core/services/api';
import type { Song } from '../../../core/types';
import {
  EXTENDED_AGGREGATE_SOURCES,
  GD_STUDIO_ATTRIBUTION,
  GD_STUDIO_RATE_LIMIT_HINT,
  SEARCH_SOURCE_OPTIONS,
  getMusicSourceLabel,
} from '../../../core/utils/musicSource';
import SongTable from '../../components/SongTable';
import { useToast } from '../../components/ToastHost';
import SearchHistoryPanel from './SearchHistoryPanel';
import { mergeSearchPage } from './searchPagination';

const historyKey = 'tunefree_search_history';
const extendedKey = 'tunefree_aggregate_extended_sources';

const loadHistory = () => {
  if (typeof window === 'undefined') return [] as string[];
  try {
    const stored = localStorage.getItem(historyKey);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
};

interface DesktopSearchProps {
  commandQuery?: string;
  commandNonce?: number;
}

export default function DesktopSearch({ commandQuery = '', commandNonce = 0 }: DesktopSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'aggregate' | 'single'>('aggregate');
  const [selectedSource, setSelectedSource] = useState('netease');
  const [includeExtendedSources, setIncludeExtendedSources] = useState(() =>
    typeof window !== 'undefined' && localStorage.getItem(extendedKey) === '1',
  );
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchError, setSearchError] = useState('');
  const [history, setHistory] = useState<string[]>(loadHistory);
  const debounceRef = useRef<number | null>(null);
  const searchRequestIdRef = useRef(0);
  const nextPagePendingRef = useRef(false);
  const resultsRef = useRef<Song[]>([]);
  const lastSearchedTermRef = useRef('');
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();

  useEffect(() => {
    localStorage.setItem(historyKey, JSON.stringify(history));
  }, [history]);

  useEffect(() => {
    localStorage.setItem(extendedKey, includeExtendedSources ? '1' : '0');
  }, [includeExtendedSources]);

  useEffect(() => {
    const pendingQuery = localStorage.getItem('tunefree_desktop_pending_query');
    if (!pendingQuery) return;
    localStorage.removeItem('tunefree_desktop_pending_query');
    setQuery(pendingQuery);
  }, []);

  useEffect(() => {
    if (!commandQuery.trim()) return;
    localStorage.removeItem('tunefree_desktop_pending_query');
    setQuery(commandQuery);
  }, [commandQuery, commandNonce]);

  useEffect(() => {
    searchRequestIdRef.current += 1;
    nextPagePendingRef.current = false;
    resultsRef.current = [];
    setResults([]);
    setIsSearching(false);
    setPage(1);
    setHasMore(true);
    setSearchError('');
  }, [query, searchMode, selectedSource, includeExtendedSources]);

  const addToHistory = useCallback((term: string) => {
    const clean = term.trim();
    if (!clean) return;
    setHistory((prev) => [clean, ...prev.filter((item) => item !== clean)].slice(0, 18));
  }, []);

  const performSearch = useCallback(async () => {
    const clean = query.trim();
    if (!clean) {
      showToast('请输入关键词后再搜索', 'warning');
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    setIsSearching(true);
    setSearchError('');
    // P3-8: Only write to history when the term differs from the last search
    if (lastSearchedTermRef.current !== clean) {
      addToHistory(clean);
      lastSearchedTermRef.current = clean;
    }
    try {
      const data = searchMode === 'aggregate'
        ? await searchAggregate(clean, page, { includeExtendedSources })
        : await searchSongs(clean, selectedSource, page);
      if (requestId !== searchRequestIdRef.current) return;
      const merged = mergeSearchPage(resultsRef.current, data, page === 1);
      resultsRef.current = merged.songs;
      setResults(merged.songs);
      setHasMore(merged.hasMore);
    } catch {
      if (requestId !== searchRequestIdRef.current) return;
      setSearchError(
        searchMode === 'single' && isGDStudioOnlySource(selectedSource)
          ? `${getMusicSourceLabel(selectedSource, 'full')} 当前不可用，或可能触发了公开接口频控（${GD_STUDIO_RATE_LIMIT_HINT}）。`
          : '搜索失败，请稍后重试。',
      );
      if (page === 1) setResults([]);
      setHasMore(false);
    } finally {
      if (requestId === searchRequestIdRef.current) {
        nextPagePendingRef.current = false;
        setIsSearching(false);
      }
    }
  }, [addToHistory, includeExtendedSources, page, query, searchMode, selectedSource, showToast]);

  useEffect(() => {
    if (!query.trim()) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      performSearch();
    }, 300);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [performSearch, query, page, searchMode, selectedSource, includeExtendedSources]);

  const requestNextPage = useCallback(() => {
    if (!hasMore || isSearching || results.length === 0 || nextPagePendingRef.current) return;
    nextPagePendingRef.current = true;
    setPage((current) => current + 1);
  }, [hasMore, isSearching, results.length]);

  const hint = useMemo(() => {
    if (searchMode === 'aggregate' && includeExtendedSources) {
      const labels = EXTENDED_AGGREGATE_SOURCES.map((source) => getMusicSourceLabel(source)).join(' / ');
      return `扩展聚合已启用：${labels}，会占用 ${GD_STUDIO_ATTRIBUTION} 的公开接口频次。`;
    }
    if (searchMode === 'single' && isGDStudioOnlySource(selectedSource)) {
      return `${getMusicSourceLabel(selectedSource, 'full')} 使用 ${GD_STUDIO_ATTRIBUTION} 公开接口，建议控制频率：${GD_STUDIO_RATE_LIMIT_HINT}。`;
    }
    return '聚合搜索会交叉合并网易云、QQ、酷我结果，适合桌面端快速试播。';
  }, [includeExtendedSources, searchMode, selectedSource]);

  const handlePlay = (song: Song) => {
    void playQueue(results, song);
  };

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
      <div className="search-layout search-layout-focused">
        <section className="search-card glass-panel search-primary-card">
          <div className="search-hero-row">
            <div>
              <p className="eyebrow">Command Search</p>
              <h1 className="page-title">搜索</h1>
            </div>
            <div className="segment-row search-mode-row">
              <button type="button" className={`segment-button ${searchMode === 'aggregate' ? 'active' : ''}`} onClick={() => setSearchMode('aggregate')}>聚合搜索</button>
              <button type="button" className={`segment-button ${searchMode === 'single' ? 'active' : ''}`} onClick={() => setSearchMode('single')}>指定源</button>
            </div>
          </div>

          <div className="command-search search-page-input">
            <SearchIcon size={20} />
            <input
              className="search-input-xl"
              aria-label="搜索关键词"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (debounceRef.current) {
                    window.clearTimeout(debounceRef.current);
                    debounceRef.current = null;
                  }
                  performSearch();
                }
              }}
              placeholder={searchMode === 'aggregate' ? '输入歌名、歌手或歌词片段…' : `搜索 ${getMusicSourceLabel(selectedSource, 'full')}…`}
            />
          </div>

          <div className="segment-row" style={{ marginTop: 14 }}>
            {searchMode === 'aggregate' ? (
              <button
                type="button"
                className={`source-chip ${includeExtendedSources ? 'active' : ''}`}
                onClick={() => setIncludeExtendedSources((prev) => !prev)}
              >
                扩展源 {includeExtendedSources ? '开' : '关'}
              </button>
            ) : (
              <div className="source-option-row" role="radiogroup" aria-label="选择搜索音源">
                {SEARCH_SOURCE_OPTIONS.map((source) => (
                  <button
                    type="button"
                    key={source}
                    role="radio"
                    aria-checked={selectedSource === source}
                    className={`source-option ${selectedSource === source ? 'active' : ''}`}
                    onClick={() => setSelectedSource(source)}
                  >
                    {getMusicSourceLabel(source, 'full')}
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="search-hint">{hint}</p>
          {searchError && <p className="search-hint" style={{ color: '#ff8a9a' }}>{searchError}</p>}

          <div className="section-header">
            <h2 className="section-title">搜索结果</h2>
            {isSearching && <span className="source-badge">搜索中</span>}
          </div>

          {!query.trim() && results.length === 0 ? (
            <div className="empty-state">
              <div>
                <MusicIcon size={48} />
                <p>输入关键词后，结果会以桌面表格形式展示。</p>
              </div>
            </div>
          ) : (
            <SongTable
              songs={results}
              currentSong={currentSong}
              isPlaying={isPlaying}
              isLoading={isSearching && results.length === 0}
              skeletonRows={8}
              emptyText="未找到相关歌曲"
              onPlay={handlePlay}
              onFavorite={handleFavorite}
              isFavorite={(song) => isFavorite(song.id, song.source)}
              onEndReached={hasMore && !isSearching ? requestNextPage : undefined}
            />
          )}

          {!isSearching && results.length > 0 && hasMore && (
            <button type="button" className="soft-button" style={{ marginTop: 14, width: '100%' }} onClick={requestNextPage}>
              加载更多结果
            </button>
          )}
        </section>

        <SearchHistoryPanel history={history} onSelect={setQuery} onClear={() => {
          if (history.length === 0) return;
          const previousHistory = history;
          setHistory([]);
          showToast('已清空搜索历史', 'success', {
            label: '撤销', onClick: () => setHistory(previousHistory),
          });
        }} />
      </div>
    </div>
  );
}
