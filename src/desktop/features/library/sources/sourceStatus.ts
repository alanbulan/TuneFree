import type { MusicSourceEntry } from '../../../../core/services/sources/manager';

export function sourceStatus(entry: MusicSourceEntry) {
  if (!entry.record.enabled) return { tone: 'idle', label: '已停用' } as const;
  if (entry.status === 'failed') return { tone: 'failed', label: entry.platforms.length ? '运行异常' : '初始化失败' } as const;
  if (entry.status === 'loading') return { tone: 'loading', label: '加载中' } as const;
  if (entry.status === 'idle') return { tone: 'idle', label: '未启动' } as const;
  const calls = entry.calls.filter((call) => call.action === 'musicUrl');
  if (calls.length === 0) return { tone: 'unverified', label: '已加载 · 待验证' } as const;
  if (calls.some((call) => !call.ok)) {
    return { tone: 'failed', label: calls.some((call) => call.ok) ? '部分解析失败' : '最近解析失败' } as const;
  }
  return { tone: 'success', label: '最近解析成功' } as const;
}
