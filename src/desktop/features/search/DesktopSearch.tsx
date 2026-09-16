import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MusicIcon } from '../../../core/components/Icons';
import { useLibrary } from '../../../core/contexts/LibraryContext';
import { usePlayerActions, usePlayerNowPlaying } from '../../../core/contexts/PlayerContext';
import { searchAggregate, searchSongs } from '../../../core/services/api';
import { getSourceGeneration, searchUsesGDStudioQuota } from '../../../core/services/sources/registry';
import { CircuitOpenError } from '../../../core/services/sources/circuitBreaker';
import { subscribeMusicSources } from '../../../core/services/sources/manager';
import type { Song } from '../../../core/types';
import {
  GD_STUDIO_RATE_LIMIT_HINT,
  getMusicSourceLabel,
} from '../../../core/utils/musicSource';
import SongTable from '../../components/SongTable';
import { useToast } from '../../components/ToastHost';
import SearchHistoryPanel from './SearchHistoryPanel';
import { useSearchHistory } from './useSearchHistory';
import { mergeSearchPage } from './searchPagination';
import SearchControls from './SearchControls';
import MotionPanel from '../../components/MotionPanel';

/**
 * 聚合搜索恒定包含扩展音源。
 *
 * 原先这是个用户开关，默认关闭——结果是大多数用户从没打开过，白白少搜了
 * 酷狗 / 咪咕 / JOOX。扩展音源本来就是「能搜到更多歌」的纯增益，
 * 失败的音源会被熔断器摘掉、并在界面上标出，不需要用户手动权衡。
 */
const INCLUDE_EXTENDED_SOURCES = true;

interface DesktopSearchProps {
  commandQuery?: string;
  commandNonce?: number;
}

export default function DesktopSearch({ commandQuery = '', commandNonce = 0 }: DesktopSearchProps) {
  useSyncExternalStore(subscribeMusicSources, getSourceGeneration, getSourceGeneration);
  const [query, setQuery] = useState(() => commandQuery.trim() ? commandQuery
    : localStorage.getItem('tunefree_desktop_pending_query') || '');
  const commandKey = `${commandNonce}:${commandQuery}`;
  const [lastCommand, setLastCommand] = useState(commandKey);
  if (lastCommand !== commandKey) {
    setLastCommand(commandKey);
    if (commandQuery.trim()) setQuery(commandQuery);
  }
  const [results, setResults] = useState<Song[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchMode, setSearchMode] = useState<'aggregate' | 'single'>('aggregate');
  const [selectedSource, setSelectedSource] = useState('netease');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchError, setSearchError] = useState('');
  const criteria = JSON.stringify([query, searchMode, selectedSource, commandNonce]);
  const [previousCriteria, setPreviousCriteria] = useState(criteria);
  const criteriaRef = useRef(criteria);
  if (previousCriteria !== criteria) {
    setPreviousCriteria(criteria);
    setResults([]); setIsSearching(false);
    setPage(1); setHasMore(true);
    setSearchError('');
  }
  const { history, setHistory, addToHistory } = useSearchHistory();
  const debounceRef = useRef<number | null>(null);
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const nextPagePendingRef = useRef(false);
  const resultsRef = useRef<Song[]>([]);
  const lastSearchedTermRef = useRef('');
  const { playQueue } = usePlayerActions();
  const { currentSong, isPlaying } = usePlayerNowPlaying();
  const { toggleFavorite, isFavorite } = useLibrary();
  const { showToast } = useToast();

  useEffect(() => {
    if (commandQuery.trim() || localStorage.getItem('tunefree_desktop_pending_query')) {
      localStorage.removeItem('tunefree_desktop_pending_query');
    }
  }, [commandQuery]);

  useLayoutEffect(() => {
    if (criteriaRef.current === criteria) return;
    criteriaRef.current = criteria;
    searchRequestIdRef.current += 1;
    searchAbortRef.current?.abort();
    nextPagePendingRef.current = false;
    resultsRef.current = [];
  }, [criteria]);

  const performSearch = useCallback(async () => {
    const clean = query.trim();
    if (!clean) {
      showToast('请输入关键词后再搜索', 'warning');
      return;
    }
    const requestId = ++searchRequestIdRef.current;
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    const baseResults = resultsRef.current;
    const applyResults = (data: Song[]) => {
      if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
      const merged = mergeSearchPage(baseResults, data, page === 1);
      resultsRef.current = merged.songs;
      setResults(merged.songs);
      return merged;
    };
    setIsSearching(true);
    setSearchError('');
    // P3-8: Only write to history when the term differs from the last search
    if (lastSearchedTermRef.current !== clean) {
      addToHistory(clean);
      lastSearchedTermRef.current = clean;
    }
    try {
      const data = searchMode === 'aggregate'
        ? await searchAggregate(clean, page, { includeExtendedSources: INCLUDE_EXTENDED_SOURCES, signal: controller.signal,
          onPartial: (partial, failed) => {
            if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
            applyResults(partial);
            if (failed.length) setSearchError(`部分音源暂不可用：${failed.map((source) => getMusicSourceLabel(source)).join('、')}`);
          },
        })
        : await searchSongs(clean, selectedSource, page, controller.signal);
      if (requestId !== searchRequestIdRef.current) return;
      const merged = applyResults(data);
      if (merged) setHasMore(merged.hasMore);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== searchRequestIdRef.current) return;
      setSearchError(
        cause instanceof CircuitOpenError
          ? `${getMusicSourceLabel(cause.platform, 'full')} 最近连续失败，已暂时停用；几秒后会自动重试一次。`
          : searchMode === 'single' && searchUsesGDStudioQuota(selectedSource)
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
  }, [addToHistory, page, query, searchMode, selectedSource, showToast]);

  useEffect(() => {
    if (!query.trim()) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      if (criteriaRef.current !== criteria) return;
      performSearch();
    }, 300);
    return () => {
      searchAbortRef.current?.abort();
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [performSearch, query, criteria]);

  const requestNextPage = useCallback(() => {
    if (!hasMore || isSearching || results.length === 0 || nextPagePendingRef.current) return;
    nextPagePendingRef.current = true;
    setPage((current) => current + 1);
  }, [hasMore, isSearching, results.length]);

  const handlePlay = (song: Song) => {
    void playQueue(results, song);
  };

  const handleFavorite = (song: Song) => {
    const wasFavorite = isFavorite(song.id, song.source);
    if (!toggleFavorite(song)) return;
    showToast(wasFavorite ? '已取消收藏' : '已收藏歌曲', 'success', {
      label: '撤销',
      onClick: () => toggleFavorite(song),
    });
  };

  return (
    <div>
      <div className="search-layout search-layout-focused">
        <section className="search-card glass-panel search-primary-card">
          <SearchControls query={query} mode={searchMode} source={selectedSource}
            onQuery={setQuery} onMode={setSearchMode} onSource={setSelectedSource}
            onSearch={() => {
              if (debounceRef.current) window.clearTimeout(debounceRef.current);
              debounceRef.current = null;
              void performSearch();
            }} />
          <MotionPanel transitionKey={`${searchMode}:${selectedSource}`}>
          {searchError && <p className="search-hint is-error">{searchError}</p>}

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
              emptyText={searchError ? '搜索服务暂不可用，请稍后重试' : '未找到相关歌曲'}
              onPlay={handlePlay}
              onFavorite={handleFavorite}
              isFavorite={(song) => isFavorite(song.id, song.source)}
              onEndReached={hasMore && !isSearching ? requestNextPage : undefined}
            />
          )}

          {!isSearching && results.length > 0 && hasMore && (
            <button type="button" className="soft-button search-load-more" onClick={requestNextPage}>
              加载更多结果
            </button>
          )}
          </MotionPanel>
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
