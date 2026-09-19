import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AudioLines, ChevronLeft, ChevronRight, Download, RefreshCw, Upload } from 'lucide-react';
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

/** 标签栏箭头一次滚动的距离，约等于两个标签的宽度。 */
const TAB_SCROLL_STEP = 220;

/**
 * 自定义音源管理页（/library/sources）。
 *
 * 布局是「音源名称标签栏 + 单个详情面板」，而不是把每个音源都堆成一张卡片：
 * 音源数量多起来之后，纵向堆叠会把页面撑得很长、必须滚动才能看全，
 * 而同一时刻用户只会关注其中一个音源。标签栏让页面高度与音源数量无关。
 *
 * 拖拽在整页统一处理，所以页面任意位置都是放置目标。
 */
export default function SourcesView() {
  const model = useMusicSourcesViewModel();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tabsOverflow, setTabsOverflow] = useState({ left: false, right: false });
  const draggingId = useRef<string | null>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const entries = model.entries;
  // 选中的音源被删除、或首次进入时，回落到列表第一项。
  const activeEntry = entries.find((entry) => entry.record.id === selectedId) ?? entries[0] ?? null;

  /**
   * 标签栏用横向滚动而不是换行：换行的高度会随音源数量增长，攒多了同样会把
   * 详情面板挤出首屏；横向滚动把高度钉死，箭头让溢出部分可见。
   */
  const updateTabsOverflow = useCallback(() => {
    const element = tabsRef.current;
    if (!element) return;
    const maxScroll = element.scrollWidth - element.clientWidth;
    setTabsOverflow({
      left: element.scrollLeft > 2,
      // 内容不足一屏时 maxScroll 为负，天然落进「没有更多」分支。
      right: element.scrollLeft < maxScroll - 2,
    });
  }, []);

  useEffect(() => {
    updateTabsOverflow();
    const element = tabsRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    // 容器尺寸变化（窗口缩放、字体加载）同样会影响是否溢出。
    const observer = new ResizeObserver(updateTabsOverflow);
    observer.observe(element);
    return () => observer.disconnect();
  // oxlint-disable-next-line react/exhaustive-effect-dependencies -- 新增/删除音源时容器宽度不变、ResizeObserver 不会触发，必须靠数量变化重新量一次。
  }, [updateTabsOverflow, entries.length]);

  const scrollTabs = (direction: -1 | 1) => {
    tabsRef.current?.scrollBy({ left: direction * TAB_SCROLL_STEP, behavior: 'smooth' });
  };

  /** 标签栏的左右方向键切换（ARIA tabs 的标准交互）。 */
  const handleTabKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1
      : event.key === 'Home' ? 0 : event.key === 'End' ? 0 : null;
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
          <button type="button" className="soft-button sources-reload" disabled={model.importing || model.reloading || model.checkingUpdates}
            onClick={() => void model.checkUpdates()}>
            <Download size={14} aria-hidden="true" /> {model.checkingUpdates ? '检查更新中…' : '检查并更新'}
          </button>
          <button type="button" className="soft-button sources-reload" disabled={model.importing || model.reloading || model.checkingUpdates} onClick={() => void model.reload()}>
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
          <p className="sources-order-hint">从左到右优先解析，可拖动调整（Alt + 左右方向键）。失败时尝试下一音源，最后使用原生解析。</p>
          <div className="source-tabs-bar">
            {tabsOverflow.left && (
              <button type="button" className="source-tabs-arrow" aria-label="向左滚动音源标签"
                onClick={() => scrollTabs(-1)}>
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
            )}
            {/* tabIndex=-1：容器本身参与键盘事件处理（方向键切换），但不进入 Tab 序列，
                焦点始终由内部的 tab 按钮承担，避免多一个空停靠点。 */}
            <div className="source-tabs" role="tablist" aria-label="音源列表" ref={tabsRef}
              tabIndex={-1} onKeyDown={handleTabKeys} onScroll={updateTabsOverflow}>
              {entries.map((entry) => {
                const status = sourceStatus(entry);
                const selected = entry.record.id === activeEntry.record.id;
                return (
                  <Tooltip key={entry.record.id} label={`${sourceDisplayText(entry.record.name)} · ${status.label}`} side="bottom">
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
                      <span className="source-tab-dot" aria-hidden="true" />
                      <span className="source-tab-name">{sourceDisplayText(entry.record.name)}</span>
                    </button>
                  </Tooltip>
                );
              })}
            </div>
            {tabsOverflow.right && (
              <button type="button" className="source-tabs-arrow" aria-label="向右滚动音源标签"
                onClick={() => scrollTabs(1)}>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="source-panel" role="tabpanel" tabIndex={-1}
            id={`source-panel-${activeEntry.record.id}`}
            aria-labelledby={`source-tab-${activeEntry.record.id}`}>
            <SourceRow key={activeEntry.record.id} entry={activeEntry} model={model} />
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
