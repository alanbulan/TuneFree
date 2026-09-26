import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AudioLines, CircleStop, Download, GripVertical, RefreshCw, Stethoscope, Upload } from 'lucide-react';
import type { SourceCapability } from '../../../core/services/sources/circuitBreaker';
import SourceImportPanel from './sources/SourceImportPanel';
import SourceRow from './sources/SourceRow';
import { sourceDisplayText } from './sources/sourceLogs';
import { sourceStatus } from './sources/sourceStatus';
import Tooltip from '../../components/Tooltip';
import { useMusicSourcesViewModel } from './sources/useMusicSourcesViewModel';

/** 熔断面板上展示的能力名。 */
const CAPABILITY_LABELS: Record<SourceCapability, string> = {
  url: '播放地址',
  lyrics: '歌词',
  pic: '封面',
  search: '搜索',
  full: '整曲解析',
};

/** 列表方向键：上下为主（纵向列表），左右保留为等价操作。 */
const KEY_OFFSETS: Record<string, -1 | 1> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * 自定义音源管理页（/library/sources）。
 *
 * 布局是「左侧带序号的纵向音源列表 + 右侧单个详情面板」：
 * 列表顺序就是解析优先级（1 最先尝试），序号把这层含义直接摆出来；
 * 纵向列表自带滚动，十几个音源也能一眼看全，而详情面板始终只展示选中的那一个。
 *
 * 拖拽在整页统一处理，所以页面任意位置都是放置目标。
 */
export default function SourcesView() {
  const model = useMusicSourcesViewModel();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const draggingId = useRef<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const entries = model.entries;
  const probingIds = model.probe?.active ?? [];
  const busy = model.importing || model.reloading || model.checkingUpdates || model.probe !== null;
  // 选中的音源被删除、或首次进入时，回落到列表第一项。
  const activeEntry = entries.find((entry) => entry.record.id === selectedId) ?? entries[0] ?? null;

  /** 列表的方向键切换（ARIA tabs 的标准交互）；按住 Alt 则把选中音源上移 / 下移一位。 */
  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = KEY_OFFSETS[event.key] ?? (event.key === 'Home' || event.key === 'End' ? 0 : null);
    if (offset === null || entries.length === 0) return;
    event.preventDefault();
    if (event.altKey && offset) {
      const index = entries.findIndex((entry) => entry.record.id === activeEntry?.record.id);
      const target = entries[index + offset];
      if (activeEntry && target) model.moveSource(activeEntry.record.id, target.record.id);
      return;
    }
    const current = Math.max(0, entries.findIndex((entry) => entry.record.id === activeEntry?.record.id));
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? entries.length - 1
        : (current + offset + entries.length) % entries.length;
    const target = entries[next];
    setSelectedId(target.record.id);
    tabsRef.current?.querySelector<HTMLButtonElement>(`#source-tab-${CSS.escape(target.record.id)}`)?.focus();
  };

  return (
    <section
      className={`sources-page${model.dropActive ? ' is-dropping' : ''}`}
      aria-label="音源管理"
      onDragOver={(event) => {
        event.preventDefault();
        if (Array.from(event.dataTransfer.types).includes('Files')) model.setDropActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        model.setDropActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        model.setDropActive(false);
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length) void model.importFiles(files);
      }}
    >
      <SourceImportPanel model={model} />

      {model.openCircuits.length > 0 && (
        <details className="sources-breaker-panel" aria-label="已熔断的通道">
          <summary>部分解析通道已暂停 <span>{model.openCircuits.length}</span><small>查看原因</small></summary>
          <p>连续失败的通道暂时跳过，不影响其他音源。冷却 5 分钟后，下次请求会尝试恢复。</p>
          <ul>
            {model.openCircuits.map((circuit) => {
              const entry = entries.find((item) => circuit.providerId.startsWith(`lx:${item.record.id}:`));
              return <li key={`${circuit.providerId}:${circuit.platform}:${circuit.capability}`}>
                <span className="breaker-provider">{sourceDisplayText(entry?.record.name ?? circuit.providerId)}</span>
                <span className="breaker-capability">{model.platformLabel(circuit.platform)} · {CAPABILITY_LABELS[circuit.capability]}</span>
                <span className="breaker-detail">连续失败 {circuit.failures} 次</span>
                <p className="breaker-error">{sourceDisplayText(circuit.lastError) || '脚本未提供具体错误信息'}</p>
              </li>;
            })}
          </ul>
        </details>
      )}

      <div className="sources-list-heading">
        <h2>全部音源 <span>{entries.length}</span></h2>
        <div className="sources-list-tools">
          {model.probe ? <>
            <span className="sources-probe-progress" role="status">检测中 {model.probe.done}/{model.probe.total}</span>
            <button type="button" className="soft-button sources-reload" onClick={model.cancelProbe}>
              <CircleStop size={14} aria-hidden="true" /> 取消检测
            </button>
          </> : (
            <button type="button" className="soft-button sources-reload sources-probe" disabled={busy || entries.length === 0}
              onClick={() => void model.probeSources(entries)}>
              <Stethoscope size={14} aria-hidden="true" /> 一键检测全部音源
            </button>
          )}
          <button type="button" className="soft-button sources-reload" disabled={busy}
            onClick={() => void model.checkUpdates()}>
            <Download size={14} aria-hidden="true" /> {model.checkingUpdates ? '检查更新中…' : '检查并更新'}
          </button>
          <button type="button" className="soft-button sources-reload" disabled={busy} onClick={() => void model.reload()}>
            <RefreshCw size={14} aria-hidden="true" /> {model.reloading ? '加载中…' : '重新加载'}
          </button>
        </div>
      </div>

      {entries.length === 0 || !activeEntry ? (
        <div className="sources-empty">
          <span className="sources-empty-icon" aria-hidden="true"><AudioLines size={28} /></span>
          <h3>还没有添加音源</h3>
          <p>导入文件或粘贴链接，即可添加。</p>
        </div>
      ) : (
        <>
          <p className="sources-order-hint">序号即解析优先级：从 1 开始依次尝试，可拖动调整（Alt + 上下方向键）。失败时尝试下一音源，最后使用原生解析。</p>
          <div className="sources-layout">
            {/* tabIndex=-1：容器本身参与键盘事件处理（方向键切换），但不进入 Tab 序列，
                焦点始终由内部的 tab 按钮承担，避免多一个空停靠点。 */}
            <div className="source-tabs" role="tablist" aria-orientation="vertical" aria-label="音源列表（按解析优先级排序）"
              ref={tabsRef} tabIndex={-1} onKeyDown={handleTabKeys}>
              {entries.map((entry, index) => {
                const status = probingIds.includes(entry.record.id)
                  ? { tone: 'loading', label: '检测中…' } : sourceStatus(entry);
                const selected = entry.record.id === activeEntry.record.id;
                return (
                  <Tooltip key={entry.record.id} label={`第 ${index + 1} 优先 · ${sourceDisplayText(entry.record.name)}`}>
                    <button type="button" role="tab"
                      id={`source-tab-${entry.record.id}`}
                      aria-selected={selected}
                      aria-controls={`source-panel-${entry.record.id}`}
                      tabIndex={selected ? 0 : -1}
                      className={`source-tab is-${status.tone}${selected ? ' is-selected' : ''}${entry.record.enabled ? '' : ' is-disabled'}`}
                      draggable
                      onDragStart={(event) => {
                        draggingId.current = entry.record.id;
                        event.dataTransfer.setData('application/x-tunefree-source', entry.record.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragOver={(event) => {
                        if (!draggingId.current) return;
                        event.preventDefault();
                        event.stopPropagation();
                        event.dataTransfer.dropEffect = 'move';
                      }}
                      onDrop={(event) => {
                        if (!draggingId.current) return;
                        event.preventDefault();
                        event.stopPropagation();
                        model.moveSource(draggingId.current, entry.record.id);
                        draggingId.current = null;
                      }}
                      onDragEnd={() => { draggingId.current = null; }}
                      onClick={() => setSelectedId(entry.record.id)}>
                      <span className="source-tab-rank">{index + 1}</span>
                      <span className="source-tab-text">
                        <span className="source-tab-name">{sourceDisplayText(entry.record.name)}</span>
                        <span className="source-tab-status"><span className="source-tab-dot" aria-hidden="true" />{status.label}</span>
                      </span>
                      <GripVertical size={14} className="source-tab-grip" aria-hidden="true" />
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            <div className="source-panel" role="tabpanel" tabIndex={-1}
              id={`source-panel-${activeEntry.record.id}`}
              aria-labelledby={`source-tab-${activeEntry.record.id}`}>
              <SourceRow key={activeEntry.record.id} entry={activeEntry} model={model} />
            </div>
          </div>
        </>
      )}
      {model.dropActive && <div className="sources-drop-hint" role="status">
        <Upload size={30} aria-hidden="true" />
        <span>松开以导入音源</span>
      </div>}
    </section>
  );
}
