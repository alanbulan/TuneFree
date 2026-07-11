import { BrainCircuit, Sparkles, WandSparkles } from 'lucide-react';
import { PlayIcon } from '../../../core/components/Icons';
import type { Song } from '../../../core/types';
import { getMusicSourceLabel } from '../../../core/utils/musicSource';

export function HomeHero({
  greeting,
  sourceLabel,
  favoritesCount,
  playlistsCount,
  firstSong,
  selectionName,
  onPlay,
  onSearch,
}: {
  greeting: string;
  sourceLabel: string;
  favoritesCount: number;
  playlistsCount: number;
  firstSong?: Song;
  selectionName: string;
  onPlay: (song: Song) => void;
  onSearch: () => void;
}) {
  return (
    <section className="hero-grid">
      <div className="hero-card">
        <p className="eyebrow">by TuneFree</p>
        <h1 className="hero-title">{greeting}</h1>
        <div className="hero-nowline"><span>桌面音乐空间</span><strong>{sourceLabel}</strong></div>
        <div className="hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => firstSong && onPlay(firstSong)}
            disabled={!firstSong}
            title={firstSong ? `播放 ${selectionName || '当前榜单'}` : '先选择榜单'}
          >
            <PlayIcon size={15} /> {firstSong ? '播放榜单' : '先选择榜单'}
          </button>
          <button type="button" className="soft-button" onClick={onSearch}>搜索音乐</button>
        </div>
      </div>
      <div className="stat-card">
        <p className="eyebrow">Library</p>
        <strong>{favoritesCount}</strong><span>收藏</span>
        <strong>{playlistsCount}</strong><span>歌单</span>
      </div>
    </section>
  );
}

const sources = [
  { key: 'netease', label: getMusicSourceLabel('netease') },
  { key: 'qq', label: getMusicSourceLabel('qq') },
  { key: 'kuwo', label: getMusicSourceLabel('kuwo') },
  { key: 'recommendation', label: '智能推荐' },
  { key: 'embeat', label: '语境搜歌' },
];

export function HomeSourceTabs({ activeSource, onChange }: { activeSource: string; onChange: (source: string) => void }) {
  return (
    <div className="section-header">
      <h2 className="section-title">推荐榜单</h2>
      <div className="inline-actions">
        {sources.map((source) => (
          <button
            type="button"
            key={source.key}
            className={`source-chip ${activeSource === source.key ? 'active' : ''} ${source.key === 'recommendation' ? 'smart-source-chip' : ''} ${source.key === 'embeat' ? 'ai-source-chip' : ''}`}
            onClick={() => onChange(source.key)}
          >
            {source.key === 'recommendation' && <BrainCircuit className="source-chip-icon" size={13} />}
            {source.key === 'embeat' && <WandSparkles className="source-chip-icon" size={13} />}
            <span>{source.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const contextTags = [
  '下雨天的咖啡馆',
  '沉浸写代码',
  '晨起舒缓轻音乐',
  '燃脂电音运动风',
  '解压伤感民谣',
  '禅意冥想与空灵',
];

export function ContextSearchPanel({
  query,
  loading,
  currentSong,
  onQueryChange,
  onSearch,
}: {
  query: string;
  loading: boolean;
  currentSong: Song | null;
  onQueryChange: (query: string) => void;
  onSearch: (query: string) => void;
}) {
  return (
    <div className="ai-rainbow-flow-border" style={{ margin: '8px 0 20px 0', padding: '22px 20px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 900 }}>语境搜歌</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--muted)' }}>
              描述想听的音乐意境、情感或特定场景，生成更贴近当下语境的歌单。
            </p>
          </div>
          {currentSong && (
            <button
              type="button"
              className="ai-radar-btn"
              onClick={() => onSearch(`和 ${currentSong.name} - ${currentSong.artist} 意境相似的歌曲`)}
            >
              <Sparkles size={13} style={{ marginRight: '5px' }} />
              <span>开启相似音乐流</span>
            </button>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) onSearch(query.trim());
          }}
          style={{ display: 'flex', gap: 10, width: '100%' }}
        >
          <input
            type="text"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Tell me what you want to hear... (例如：适合沉浸写代码的纯音乐)"
            style={{
              flex: 1, minHeight: '40px', padding: '0 14px', borderRadius: '10px',
              border: '1px solid var(--border-soft)', background: 'var(--surface-soft)',
              color: 'var(--text)', fontSize: '13px', outline: 'none',
            }}
          />
          <button
            type="submit"
            className="primary-button"
            style={{ minHeight: '40px', padding: '0 20px', borderRadius: '10px', fontWeight: 900 }}
            disabled={loading || !query.trim()}
          >
            {loading ? '分析中…' : '语境搜歌'}
          </button>
        </form>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 800 }}>推荐语境：</span>
          {contextTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => { onQueryChange(tag); onSearch(tag); }}
              style={{
                padding: '5px 12px', borderRadius: '8px', border: '1px solid var(--border-soft)',
                background: 'var(--surface-soft)', color: 'var(--text-soft)', fontSize: '11px',
                fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s ease',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = 'var(--accent)';
                event.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = 'var(--border-soft)';
                event.currentTarget.style.color = 'var(--text-soft)';
              }}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
