import { useId, useMemo, useState } from 'react';
import { Activity, AudioLines, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, Trash2 } from 'lucide-react';
import type { MusicSourceEntry } from '../../../../core/services/sources/manager';
import type { MusicSourcesViewModel } from './useMusicSourcesViewModel';
import { sourceStatus } from './sourceStatus';
import Tooltip from '../../../components/Tooltip';
import { summarizeSourceLogs } from './sourceLogs';

/** 每页展示多少条日志卡片。 */
const LOGS_PER_PAGE = 4;
/** 诊断区最多展示多少条解析记录（只保留最近的）。 */
const VISIBLE_CALLS = 3;

/** 诊断常驻卡片；补充资料与匹配设置收在详情中。 */
export default function SourceRow({ entry, model }: { entry: MusicSourceEntry; model: MusicSourcesViewModel }) {
  const { record, error, platforms, updateAlert, hosts, logs, calls, update } = entry;
  const expanded = model.expandedId === record.id;
  const detailId = useId();
  const version = record.version.replace(/^v/i, '');
  const isBuiltin = record.builtin === true;
  const status = sourceStatus(entry);
  const urlCalls = calls.filter((call) => call.action === 'musicUrl');
  const visibleCalls = urlCalls.slice(-VISIBLE_CALLS);
  const hiddenCallCount = urlCalls.length - visibleCalls.length;
  const logSummary = useMemo(() => summarizeSourceLogs(logs), [logs]);
  const [logPage, setLogPage] = useState(0);
  const logPageCount = Math.max(1, Math.ceil(logSummary.entries.length / LOGS_PER_PAGE));
  // 日志会随运行增删（沙箱有上限），页码可能越界，渲染时收拢而不是写 state。
  const safeLogPage = Math.min(logPage, logPageCount - 1);
  const visibleLogs = logSummary.entries.slice(
    safeLogPage * LOGS_PER_PAGE,
    safeLogPage * LOGS_PER_PAGE + LOGS_PER_PAGE,
  );

  return (
    <article className={`source-row is-${status.tone}${!record.enabled ? ' is-disabled' : ''}${expanded ? ' is-expanded' : ''}`}>
      <div className="source-row-main">
        <span className="source-avatar" aria-hidden="true"><AudioLines size={22} /></span>
        <div className="source-identity">
          <div className="source-title-row">
            <Tooltip label={record.name}><h3 className="source-name">{record.name}</h3></Tooltip>
            {isBuiltin && <span className="source-builtin-label">内置</span>}
            {version && <span className="source-version">{isBuiltin ? '适配 ' : ''}v{version}</span>}
          </div>
          <div className="source-platforms">
            {platforms.map((platform) => <span key={platform.lxPlatform} className="source-platform-label">
              {model.platformLabel(platform.appPlatform)}
            </span>)}
            {platforms.length === 0 && <span className="source-platform-empty">尚无可用平台声明</span>}
          </div>
        </div>
        <div className="source-row-actions">
          <span className={`source-status is-${status.tone}`}>{status.label}</span>
          {!isBuiltin && <input type="checkbox" role="switch" className="source-enabled-toggle" checked={record.enabled}
            aria-checked={record.enabled} aria-label={`启用 ${record.name}`}
            onChange={(event) => model.toggleEnabled(entry, event.target.checked)} />}
          <button type="button" className="soft-button source-details-toggle" aria-expanded={expanded}
            aria-controls={expanded ? detailId : undefined} aria-label={`${expanded ? '收起' : '展开'} ${record.name} 的详情`}
            onClick={() => model.toggleExpanded(record.id)}>
            {expanded ? '收起' : '详情'} <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      <section className="source-diagnostics" aria-label={`${record.name} 诊断信息`}>
        <div className="source-diagnostics-heading">
          <h4><Activity size={14} aria-hidden="true" /> 诊断信息</h4>
          <span>{entry.status === 'ready' ? '初始化完成' : entry.status === 'failed' && platforms.length ? '运行已中止' : '初始化未完成'}</span>
        </div>
        {error && <p className="source-error" role="alert">{error}</p>}
        {urlCalls.length === 0 ? <p className="source-diagnostic-note">
          {!record.enabled ? '启用后加载脚本，并在播放时记录解析结果。'
            : entry.status === 'ready' ? '等待首次解析。脚本已加载，播放地址尚未验证。'
              : entry.status === 'failed' && platforms.length ? '脚本运行异常，重新加载后可再次尝试。'
                : '脚本尚未完成初始化，暂不能提供解析。'}
        </p> : <ul className="source-call-list">
          {/* 只留最近的几条：这段是逐平台的解析记录，攒多了会把整页顶出首屏，
              而排查时真正关心的是「最近一次」而不是全部历史。 */}
          {visibleCalls.map((call) => <li key={`${call.source}-${call.action}-${call.checkedAt}`} className={call.ok ? 'is-success' : 'is-failed'}>
            <span className="source-call-platform">{model.platformLabel(platforms.find((platform) => platform.lxPlatform === call.source)?.appPlatform ?? call.source)}</span>
            <span>{call.ok ? '返回有效播放地址' : call.message}</span>
            <small>{call.quality} · {(call.durationMs / 1000).toFixed(1)} 秒 · {new Date(call.checkedAt).toLocaleTimeString('zh-CN', { hour12: false })}</small>
          </li>)}
          {hiddenCallCount > 0 && <li className="source-call-more">另有 {hiddenCallCount} 条更早的解析记录</li>}
        </ul>}
        {hosts.length > 0 && <p className="source-hosts">访问主机 <span>{hosts.join(' · ')}</span></p>}
        {logSummary.total > 0 && (
          // 默认收起：日志是排查时才看的东西，常驻展开会把整页撑得又长又吵。
          <details className="source-log">
            <summary>
              <ChevronDown size={13} className="source-log-arrow" aria-hidden="true" />
              <span className="source-log-title">运行日志</span>
              <span className="source-log-count">{logSummary.entries.length} 类 · {logSummary.total} 条</span>
              {logSummary.problems > 0 && (
                <span className="source-log-problems">{logSummary.problems} 条异常</span>
              )}
            </summary>
            {/* 分页列表：时间 · 级别徽标 · 内容，不用滚动条。 */}
            <ol className="source-log-rows" aria-label={`${record.name} 运行日志`}>
              {visibleLogs.map((item) => (
                <li key={JSON.stringify([item.tag, item.message])} className={`is-${item.tone}`}>
                  <time className="source-log-time">{item.time || '--:--:--'}</time>
                  <span className="source-log-tag">{item.tag || '日志'}</span>
                  <span className="source-log-message">{item.message}</span>
                  {item.count > 1 && <span className="source-log-repeat">×{item.count}</span>}
                </li>
              ))}
            </ol>
            {logPageCount > 1 && (
              <div className="source-log-pager">
                <button type="button" className="soft-button" aria-label="上一页日志"
                  disabled={safeLogPage === 0} onClick={() => setLogPage(safeLogPage - 1)}>
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <span aria-live="polite">第 {safeLogPage + 1} / {logPageCount} 页</span>
                <button type="button" className="soft-button" aria-label="下一页日志"
                  disabled={safeLogPage >= logPageCount - 1} onClick={() => setLogPage(safeLogPage + 1)}>
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            )}
          </details>
        )}
        {update && <p className={`source-update-state is-${update.status}`} role="status">{update.message}</p>}
        {updateAlert && update?.status !== 'updated' && <div className="source-alert">
          <span>{updateAlert.log}</span>
          {updateAlert.updateUrl && <button type="button" className="soft-button"
            onClick={() => void model.openHomepage(updateAlert.updateUrl!)}>查看更新</button>}
        </div>}
      </section>

      {expanded && <div className="source-detail" id={detailId}>
        {record.description && <p className="source-description">{record.description}</p>}
        <dl className="source-detail-grid">
          {record.author && <div><dt>{isBuiltin ? '接口作者' : '作者'}</dt><dd>{record.author}</dd></div>}
          <div><dt>文件</dt><dd>{record.fileName}</dd></div>
          <div><dt>平台与声明音质</dt><Tooltip label="实际音质以接口返回为准"><dd className="source-quality-list">
            {platforms.length === 0 ? '无' : platforms.map((platform) => <div key={platform.lxPlatform}>
              <strong>{model.platformLabel(platform.appPlatform)}</strong>
              <span>{platform.qualitys?.join(' / ') || '由脚本决定'}</span>
            </div>)}
          </dd></Tooltip></div>
        </dl>
        {!isBuiltin && <label className="source-name-match">
          <span><strong>允许按歌名匹配</strong><small>可能匹配到不同的演唱版本</small></span>
          <input type="checkbox" role="switch" className="source-enabled-toggle" aria-label="允许按歌名匹配"
            checked={record.nameMatchFallback} aria-checked={record.nameMatchFallback}
            onChange={(event) => model.toggleNameMatch(record.id, event.target.checked)} />
        </label>}
        <div className="source-detail-actions">
          {record.homepage && <button type="button" className="soft-button source-secondary-action"
            onClick={() => void model.openHomepage(record.homepage)}><ExternalLink size={14} aria-hidden="true" /> 主页</button>}
          {!isBuiltin && <button type="button" className="soft-button source-remove" onClick={() => void model.remove(entry)}>
            <Trash2 size={14} aria-hidden="true" /> 删除音源
          </button>}
        </div>
      </div>}
    </article>
  );
}
