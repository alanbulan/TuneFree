import { AudioLines, RefreshCw, Upload } from 'lucide-react';
import SourceImportPanel from './sources/SourceImportPanel';
import SourceRow from './sources/SourceRow';
import { useMusicSourcesViewModel } from './sources/useMusicSourcesViewModel';

/**
 * 自定义音源管理页（/library/sources）。
 *
 * 页面只做编排：导入区 + 音源列表 + 空态；拖拽在此统一处理，
 * 因此列表区域整体都是放置目标。
 */
export default function SourcesView() {
  const model = useMusicSourcesViewModel();

  return (
    <section
      className={`sources-page${model.dropActive ? ' is-dropping' : ''}`}
      aria-label="音源管理"
      onDragOver={(event) => {
        event.preventDefault();
        model.setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        model.setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        model.setDropActive(false);
        void model.importFiles(Array.from(event.dataTransfer?.files ?? []));
      }}
    >
      <SourceImportPanel model={model} />

      <div className="sources-list-heading">
        <h2>全部音源 <span>{model.entries.length}</span></h2>
        <div className="sources-list-tools">
          {model.readyCount > 0 && <span className="sources-ready-count">{model.readyCount} 个就绪</span>}
          <button type="button" className="soft-button sources-reload" disabled={model.importing} onClick={model.reload}>
            <RefreshCw size={14} aria-hidden="true" /> 重新加载
          </button>
        </div>
      </div>

      {model.entries.length === 0 ? (
        <div className="sources-empty">
          <span className="sources-empty-icon" aria-hidden="true"><AudioLines size={28} /></span>
          <h3>还没有添加音源</h3>
          <p>导入文件或粘贴链接，即可添加。</p>
        </div>
      ) : (
        <ul className="source-list" aria-label="音源列表">
          {model.entries.map((entry) => (
            <SourceRow key={entry.record.id} entry={entry} model={model} />
          ))}
        </ul>
      )}
      {model.dropActive && <div className="sources-drop-hint" role="status">
        <Upload size={30} aria-hidden="true" />
        <span>松开以导入音源</span>
      </div>}
    </section>
  );
}
