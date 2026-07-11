import { TrashIcon } from '../../../core/components/Icons';

interface SearchHistoryPanelProps {
  history: string[];
  onSelect: (term: string) => void;
  onClear: () => void;
}

export default function SearchHistoryPanel({ history, onSelect, onClear }: SearchHistoryPanelProps) {
  return (
    <aside className="content-card glass-panel">
      <div className="panel-label-row">
        <h3>搜索历史</h3>
        <button type="button" className="icon-button" aria-label="清空历史" onClick={onClear}>
          <TrashIcon size={16} />
        </button>
      </div>
      <div className="segment-row history-chip-row">
        {history.length === 0 ? (
          <p className="muted-text">暂无历史记录</p>
        ) : history.map((term) => (
          <button type="button" className="source-chip" key={term} onClick={() => onSelect(term)}>
            {term}
          </button>
        ))}
      </div>
    </aside>
  );
}
