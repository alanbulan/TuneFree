import { useId } from 'react';
import { SearchIcon } from '../../../core/components/Icons';
import { SEARCH_SOURCE_OPTIONS, getMusicSourceLabel } from '../../../core/utils/musicSource';
import MotionChoice from '../../components/MotionChoice';
import MotionPanel from '../../components/MotionPanel';

interface SearchControlsProps {
  query: string;
  mode: 'aggregate' | 'single';
  source: string;
  extended: boolean;
  onQuery: (value: string) => void;
  onMode: (value: 'aggregate' | 'single') => void;
  onSource: (value: string) => void;
  onExtended: (value: boolean) => void;
  onSearch: () => void;
}

export default function SearchControls({ query, mode, source, extended, onQuery, onMode, onSource, onExtended, onSearch }: SearchControlsProps) {
  const indicatorId = useId();
  return (
    <>
      <div className="search-hero-row">
        <div><h1 className="page-title">搜索</h1><p className="page-description">找到想听的那首歌。</p></div>
        <div className="segment-row search-mode-row" role="group" aria-label="搜索范围">
          <MotionChoice className="segment-button" selected={mode === 'aggregate'} indicatorId={`${indicatorId}-mode`}
            onClick={() => onMode('aggregate')}>全部音源</MotionChoice>
          <MotionChoice className="segment-button" selected={mode === 'single'} indicatorId={`${indicatorId}-mode`}
            onClick={() => onMode('single')}>指定音源</MotionChoice>
        </div>
      </div>
      <div className="command-search search-page-input">
        <SearchIcon size={20} />
        <input className="search-input-xl" aria-label="搜索关键词" value={query}
          onChange={(event) => onQuery(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault(); onSearch();
            }
          }} placeholder={mode === 'aggregate' ? '输入歌名、歌手或歌词片段…' : `搜索 ${getMusicSourceLabel(source, 'full')}…`} />
      </div>
      <MotionPanel className="segment-row search-source-row" transitionKey={mode}>
        {mode === 'aggregate' ? (
          <MotionChoice className="source-chip" selected={extended} indicatorId={`${indicatorId}-extended`}
            onClick={() => onExtended(!extended)}>扩展源 {extended ? '开' : '关'}</MotionChoice>
        ) : (
          <div className="source-option-row" role="radiogroup" aria-label="选择搜索音源">
            {SEARCH_SOURCE_OPTIONS.map((option) => (
              <MotionChoice key={option} role="radio" aria-checked={source === option} aria-pressed={undefined}
                className="source-option" selected={source === option} indicatorId={`${indicatorId}-source`}
                onClick={() => onSource(option)}>{getMusicSourceLabel(option, 'full')}</MotionChoice>
            ))}
          </div>
        )}
      </MotionPanel>
    </>
  );
}
