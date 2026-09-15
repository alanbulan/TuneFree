import { useId } from 'react';
import { AudioLines, ChevronDown, ExternalLink, Trash2 } from 'lucide-react';
import type { MusicSourceEntry } from '../../../../core/services/sources/manager';
import type { SandboxStatus } from '../../../../core/services/sources/workerHost';
import type { MusicSourcesViewModel } from './useMusicSourcesViewModel';

const STATUS_LABELS: Record<SandboxStatus, string> = {
  idle: '未启动',
  loading: '加载中',
  ready: '已就绪',
  failed: '加载失败',
};

/** 单个音源卡片：状态、声明的平台、启停与详情。 */
export default function SourceRow({
  entry,
  model,
}: {
  entry: MusicSourceEntry;
  model: MusicSourcesViewModel;
}) {
  const { record, status, error, platforms, updateAlert, hosts, logs } = entry;
  const expanded = model.expandedId === record.id;
  const detailId = useId();
  const version = record.version.replace(/^v/i, '');
  // 内置脚本（随应用分发）不可删除、不可停用，只展示状态与详情。
  const isBuiltin = record.builtin === true;

  return (
    <li className={`source-row is-${status}${!record.enabled ? ' is-disabled' : ''}${expanded ? ' is-expanded' : ''}`}>
      <div className="source-row-main">
        <span className="source-avatar" aria-hidden="true"><AudioLines size={22} /></span>
        <div className="source-identity">
          <div className="source-title-row">
            <h3 className="source-name" title={record.name}>{record.name}</h3>
            {isBuiltin && <span className="source-builtin-label">内置</span>}
            {version && <span className="source-version">{isBuiltin ? '适配 ' : ''}v{version}</span>}
          </div>
          <div className="source-platforms">
            {platforms.map((platform) => (
              <span key={platform.lxPlatform} className="source-platform-label">
                {model.platformLabel(platform.appPlatform)}
              </span>
            ))}
            {platforms.length === 0 && status === 'ready' && (
              <span className="source-platform-empty">未声明可用平台</span>
            )}
          </div>
        </div>
        <div className="source-row-actions">
          <span className={`source-status is-${status}`}>{!record.enabled ? '已停用' : STATUS_LABELS[status]}</span>
          {!isBuiltin && (
            <input type="checkbox" role="switch" className="source-enabled-toggle" checked={record.enabled}
              aria-checked={record.enabled}
              aria-label={`启用 ${record.name}`} onChange={(event) => model.toggleEnabled(entry, event.target.checked)} />
          )}
          <button type="button" className="soft-button source-details-toggle" aria-expanded={expanded}
            aria-controls={expanded ? detailId : undefined} aria-label={`${expanded ? '收起' : '展开'} ${record.name} 的详情`}
            onClick={() => model.toggleExpanded(record.id)}>
            {expanded ? '收起' : '详情'} <ChevronDown size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && <p className="source-error" role="alert">{error}</p>}

      {expanded && (
        <div className="source-detail" id={detailId}>
          {record.description && <p className="source-description">{record.description}</p>}
          <dl className="source-detail-grid">
            {record.author && <div><dt>{isBuiltin ? '接口作者' : '作者'}</dt><dd>{record.author}</dd></div>}
            <div>
              <dt>文件</dt>
              <dd>{record.fileName}</dd>
            </div>
            <div>
              <dt>{isBuiltin ? '平台与请求音质' : '平台与音质'}</dt>
              <dd title={isBuiltin ? '实际音质以接口返回为准' : undefined}>
                {platforms.length === 0
                  ? '无'
                  : platforms
                      .map((platform) => {
                        const qualities = platform.qualitys?.join(' / ') || '由脚本决定';
                        return `${model.platformLabel(platform.appPlatform)}（${qualities}）`;
                      })
                      .join('、')}
              </dd>
            </div>
          </dl>

          {!isBuiltin && (
            <label className="source-name-match">
              <span><strong>允许按歌名匹配</strong><small>可能匹配到不同的演唱版本</small></span>
              <input
                type="checkbox"
                role="switch"
                className="source-enabled-toggle"
                aria-label="允许按歌名匹配"
                checked={record.nameMatchFallback}
                aria-checked={record.nameMatchFallback}
                onChange={(event) => model.toggleNameMatch(record.id, event.target.checked)}
              />
            </label>
          )}

          {updateAlert && (
            <p className="source-alert">
              <span>{updateAlert.log}</span>
              {updateAlert.updateUrl && (
                <button type="button" className="soft-button" onClick={() => void model.openHomepage(updateAlert.updateUrl!)}>
                  查看更新
                </button>
              )}
            </p>
          )}

          {(hosts.length > 0 || logs.length > 0) && (
            <details className="source-diagnostics">
              <summary>诊断信息</summary>
              {hosts.length > 0 && <p>访问记录：{hosts.join('、')}</p>}
              {logs.length > 0 && <pre>{logs.join('\n')}</pre>}
            </details>
          )}
          <div className="source-detail-actions">
            {record.homepage && (
              <button type="button" className="soft-button source-secondary-action" onClick={() => void model.openHomepage(record.homepage)}>
                <ExternalLink size={14} aria-hidden="true" /> 主页
              </button>
            )}
            {!isBuiltin && (
              <button type="button" className="soft-button source-remove" onClick={() => void model.remove(entry)}>
                <Trash2 size={14} aria-hidden="true" /> 删除音源
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
