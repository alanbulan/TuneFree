/**
 * 音源熔断器：把「上游已经死掉的通道」从热路径上摘下来。
 *
 * 背景：同一个 provider 在不同平台、不同能力上的存活情况是**互相独立**的
 * （实测 GD 音乐台的 netease 全通道可用，kuwo / joox 只剩歌词与封面，
 * tencent 整条线已被上游下掉）。把事实写死在脚本声明里只能覆盖「今天」，
 * 上游哪天再挂一个平台，用户看到的还是一次次白跑的请求与满屏失败日志。
 *
 * 因此按 (provider, 平台, 能力) 三元组独立计数：
 * - 连续失败到阈值 → 打开熔断，后续调用直接跳过，让位给下一个 provider 或跨源兜底；
 * - 冷却期满 → 半开，放一次探测请求；成功即恢复，失败则重新计时。
 *
 * 只有**抛错**才算失败。provider 因为没有这项内容而返回 null / 空字符串属于
 * 「不适用」而不是「坏了」，算进失败会误伤正常通道（大量歌曲本来就没有歌词）。
 */

export type SourceCapability = 'url' | 'lyrics' | 'pic' | 'search' | 'full';

/**
 * 熔断打开时抛出：该平台的能力已被暂时摘掉，不该再发请求。
 *
 * 用独立类型而不是普通 Error，是为了让界面能区分「上游坏了」和「我们主动
 * 暂停了它」——后者要告诉用户「稍后会自己恢复」，而不是笼统的「搜索失败」。
 */
export class CircuitOpenError extends Error {
  readonly platform: string;
  readonly capability: SourceCapability;

  constructor(platform: string, capability: SourceCapability) {
    super(`${platform} 的 ${capability} 通道连续失败，已暂时跳过`);
    this.name = 'CircuitOpenError';
    this.platform = platform;
    this.capability = capability;
  }
}

/** 连续失败多少次后打开熔断。 */
const FAILURE_THRESHOLD = 3;
/** 熔断打开后的冷却时长；期满放行一次探测。 */
const OPEN_MS = 5 * 60_000;
/** 最多跟踪多少个三元组，防止异常输入把表撑大。 */
const MAX_TRACKED = 300;

interface BreakerState {
  providerId: string;
  platform: string;
  capability: SourceCapability;
  failures: number;
  openedAt: number;
  /** 半开状态下已经放出探测请求，未回结果前不再放第二个。 */
  probing: boolean;
  lastError: string;
}

/**
 * 键只用于查表，三元组本身存在 value 里。
 *
 * 不用「拼接 + 分隔符」是因为 provider id 里已经有冒号（`lx:<scriptId>:<平台>`），
 * 任何分隔符都得额外论证不会碰撞；直接存结构化数据就不需要论证。
 */
const states = new Map<string, BreakerState>();
const listeners = new Set<() => void>();
let cachedSnapshot: CircuitSnapshotEntry[] | null = null;

const keyOf = (providerId: string, platform: string, capability: SourceCapability): string =>
  JSON.stringify([providerId, platform, capability]);

const notify = (): void => {
  cachedSnapshot = null;
  for (const listener of listeners) listener();
};

/** 订阅熔断状态变化（音源管理页通过 useSyncExternalStore 挂上来）。 */
export const subscribeCircuitBreaker = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * 该通道当前是否应该跳过。
 *
 * 冷却期满时把状态切成「半开」并放行一次：调用方拿到 false 之后必须最终调用
 * recordSuccess / recordFailure，否则这条通道会一直停在探测中。
 */
export const isCircuitOpen = (
  providerId: string,
  platform: string,
  capability: SourceCapability,
): boolean => {
  const state = states.get(keyOf(providerId, platform, capability));
  if (!state || state.failures < FAILURE_THRESHOLD) return false;
  if (state.probing) return true;
  if (Date.now() - state.openedAt < OPEN_MS) return true;
  state.probing = true;
  return false;
};

export const recordSuccess = (
  providerId: string,
  platform: string,
  capability: SourceCapability,
): void => {
  const key = keyOf(providerId, platform, capability);
  if (!states.delete(key)) return;
  notify();
};

export const recordFailure = (
  providerId: string,
  platform: string,
  capability: SourceCapability,
  error: unknown,
): void => {
  const key = keyOf(providerId, platform, capability);
  const message = error instanceof Error ? error.message : String(error ?? '');
  const state = states.get(key);
  if (!state) {
    if (states.size >= MAX_TRACKED) {
      // 淘汰最早写入的一条：Map 保持插入顺序，够用且不需要额外结构。
      const oldest = states.keys().next();
      if (!oldest.done) states.delete(oldest.value);
    }
    states.set(key, {
      providerId, platform, capability,
      failures: 1, openedAt: 0, probing: false, lastError: message,
    });
    notify();
    return;
  }
  state.failures += 1;
  state.lastError = message;
  state.probing = false;
  if (state.failures >= FAILURE_THRESHOLD) state.openedAt = Date.now();
  notify();
};

export interface CircuitSnapshotEntry {
  providerId: string;
  platform: string;
  capability: SourceCapability;
  failures: number;
  /** 熔断打开的剩余冷却毫秒数；0 表示未打开或已可探测。 */
  cooldownMs: number;
  lastError: string;
}

/** 已打开熔断的通道列表，供音源管理页展示。 */
export const getOpenCircuits = (): CircuitSnapshotEntry[] => {
  if (cachedSnapshot) return cachedSnapshot;
  const now = Date.now();
  const entries: CircuitSnapshotEntry[] = [];
  for (const state of states.values()) {
    if (state.failures < FAILURE_THRESHOLD) continue;
    entries.push({
      providerId: state.providerId,
      platform: state.platform,
      capability: state.capability,
      failures: state.failures,
      cooldownMs: Math.max(0, OPEN_MS - (now - state.openedAt)),
      lastError: state.lastError,
    });
  }
  cachedSnapshot = entries;
  return entries;
};

/** 重新加载音源、导入新脚本后清空，让用户的手动操作立刻生效。 */
export const resetCircuits = (): void => {
  if (states.size === 0) return;
  states.clear();
  notify();
};
