import { useId, useRef } from 'react';
import { ArrowRight, BrainCircuit, LoaderCircle, Sparkles } from 'lucide-react';
import { PlayIcon } from '../../../core/components/Icons';
import type { Song } from '../../../core/types';
import { getMusicSourceLabel } from '../../../core/utils/musicSource';
import MotionChoice from '../../components/MotionChoice';

export function HomeHero({
  greeting, favoritesCount, playlistsCount, firstSong, selectionName, onPlay,
}: {
  greeting: string;
  favoritesCount: number;
  playlistsCount: number;
  firstSong?: Song;
  selectionName: string;
  onPlay: (song: Song) => void;
}) {
  return (
    <section className="hero-grid">
      <div className="hero-card">
        <p className="eyebrow">让音乐陪你度过此刻</p>
        <h1 className="hero-title">{greeting}</h1>
        <p className="hero-copy">从熟悉的旋律，到下一首心动。</p>
        {firstSong && (
          <button type="button" className="primary-button hero-play"
            onClick={() => onPlay(firstSong)} title={`播放 ${selectionName || '当前歌单'}`}>
            <PlayIcon size={15} /> 播放当前歌单
          </button>
        )}
      </div>
      <dl className="stat-card home-library-stats" aria-label="我的音乐库">
        <div><dt>收藏歌曲</dt><dd>{favoritesCount}</dd></div>
        <div><dt>我的歌单</dt><dd>{playlistsCount}</dd></div>
      </dl>
    </section>
  );
}

const sources = [
  { key: 'netease', label: getMusicSourceLabel('netease') },
  { key: 'qq', label: getMusicSourceLabel('qq') },
  { key: 'kuwo', label: getMusicSourceLabel('kuwo') },
  { key: 'recommendation', label: '为你推荐' },
  { key: 'embeat', label: 'AI 搜歌' },
];

export function HomeSourceTabs({ activeSource, onChange }: { activeSource: string; onChange: (source: string) => void }) {
  const indicatorId = useId();
  return (
    <div className="section-header home-source-header">
      <h2 className="section-title">发现音乐</h2>
      <div className="source-switch" role="group" aria-label="选择音源或推荐方式">
        {sources.map((source) => (
          <MotionChoice key={source.key} indicatorId={indicatorId} selected={activeSource === source.key}
            className={`source-chip${source.key === 'recommendation' ? ' source-chip-divider' : ''}`}
            onClick={() => onChange(source.key)}>
            {source.key === 'recommendation' && <BrainCircuit size={14} />}
            {source.key === 'embeat' && <Sparkles size={14} />}
            <span>{source.label}</span>
          </MotionChoice>
        ))}
      </div>
    </div>
  );
}

const contextTags = ['下雨天的咖啡馆', '沉浸写代码', '晨起舒缓轻音乐', '夜晚散步'];

export function ContextSearchPanel({
  query, loading, onQueryChange, onSearch, onCancel,
}: {
  query: string;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fillPrompt = (prompt: string) => {
    onQueryChange(prompt);
    inputRef.current?.focus();
  };
  return (
    <section className="context-search-panel" aria-labelledby="context-search-title">
      <div className="context-search-head">
        <div className="context-heading">
          <span className="context-heading-icon" aria-hidden="true"><Sparkles size={21} /></span>
          <div>
            <h3 id="context-search-title">这一刻，想听什么？</h3>
            <p>一种心情、一个场景，让音乐跟上你的此刻。</p>
          </div>
        </div>
      </div>
      <form className="context-search-form" onSubmit={(event) => {
        event.preventDefault();
        if (!loading && query.trim()) onSearch(query.trim());
      }}>
        <input ref={inputRef} type="text" className="context-search-input" value={query}
          aria-label="描述想听的音乐" disabled={loading}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
          }}
          placeholder="例如：适合雨天独处的轻柔爵士" />
        {loading ? (
          <button type="button" className="soft-button context-search-submit" onClick={onCancel}>停止生成</button>
        ) : (
          <button type="submit" className="primary-button context-search-submit" disabled={!query.trim()}>
            生成歌单 <ArrowRight size={16} />
          </button>
        )}
      </form>
      <div className="context-tag-row">
        <span className="context-tag-label">试试</span>
        {contextTags.map((tag) => (
          <button key={tag} type="button" className="context-tag" disabled={loading}
            onClick={() => fillPrompt(tag)}>{tag}</button>
        ))}
      </div>
      <p className="context-search-status" role="status">
        {loading ? <><LoaderCircle size={14} className="context-loading-icon" /> 正在为你挑选音乐…</>
          : '选择一个灵感，或用自己的话描述。准备好后，按 Enter 生成。'}
      </p>
    </section>
  );
}
