import type { CSSProperties } from 'react';

export interface StorageOverviewSegment {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  color: string;
}

export interface StorageOverviewStat {
  label: string;
  value: string;
  detail: string;
}

interface StorageOverviewCardProps {
  error?: string;
  totalLabel: string;
  totalValue: string;
  segments: StorageOverviewSegment[];
  stats: StorageOverviewStat[];
}

interface StorageDonutChartProps {
  totalLabel: string;
  totalValue: string;
  segments: StorageOverviewSegment[];
}

const donutRadius = 42;
const donutCircumference = 2 * Math.PI * donutRadius;

function StorageDonutChart({ totalLabel, totalValue, segments }: StorageDonutChartProps) {
  const visibleSegments = segments.filter((segment) => segment.value > 0);
  const totalBytes = visibleSegments.reduce((sum, segment) => sum + segment.value, 0);
  let offset = 0;
  const arcs = [];
  for (const segment of visibleSegments) {
    const dash = totalBytes > 0 ? (segment.value / totalBytes) * donutCircumference : 0;
    arcs.push({ segment, dash, strokeDashoffset: -offset });
    offset += dash;
  }

  return (
    <div className="storage-donut-wrap" aria-label={`${totalLabel} ${totalValue}`}>
      <svg className="storage-donut" viewBox="0 0 104 104" role="img">
        <circle className="storage-donut-track" cx="52" cy="52" r={donutRadius} />
        {arcs.map(({ segment, dash, strokeDashoffset }) => {
          return (
            <circle
              key={segment.id}
              className="storage-donut-segment"
              cx="52"
              cy="52"
              r={donutRadius}
              stroke={segment.color}
              strokeDasharray={`${dash} ${donutCircumference - dash}`}
              strokeDashoffset={strokeDashoffset}
            />
          );
        })}
      </svg>
      <div className="storage-donut-center">
        <span>{totalLabel}</span>
        <strong>{totalValue}</strong>
      </div>
    </div>
  );
}

export default function StorageOverviewCard({
  error,
  totalLabel,
  totalValue,
  segments,
  stats,
}: StorageOverviewCardProps) {
  const totalBytes = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);

  return (
    <div className="settings-card storage-overview-card glass-panel">
      <div className="storage-overview-header">
        <div>
          <h3>存储概览</h3>
          <p>本地歌曲、推荐数据和 JSON 备份占用汇总</p>
        </div>
      </div>

      {error && <p className="settings-error-text" role="status">{error}</p>}

      <div className="storage-overview-body">
        <StorageDonutChart totalLabel={totalLabel} totalValue={totalValue} segments={segments} />
        <div className="storage-segment-list">
          {segments.map((segment) => {
            const percent = totalBytes > 0 ? Math.round((segment.value / totalBytes) * 100) : 0;
            return (
              <div
                className="storage-segment-row"
                key={segment.id}
                style={{ '--storage-color': segment.color } as CSSProperties}
              >
                <div className="storage-segment-label">
                  <span />
                  <strong>{segment.label}</strong>
                  <em>{segment.formattedValue}</em>
                </div>
                <div className="storage-meter" aria-label={`${segment.label} ${percent}%`}>
                  <span style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="storage-stat-grid">
        {stats.map((stat) => (
          <div className="storage-stat-item" key={stat.label}>
            <span>{stat.label}</span>
            <strong>{stat.value}</strong>
            <em>{stat.detail}</em>
          </div>
        ))}
      </div>
    </div>
  );
}
