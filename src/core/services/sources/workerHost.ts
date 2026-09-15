import { abortReasonError } from '../resolverMatch';
import { CookieJar } from './cookieJar';
import { normalizeSources, normalizeUpdateAlert, readSourceUrl, type SourceCallDiagnostic } from './diagnostics';
import { declarationPlatform } from './platformMap';
import {
  LX_INITED_EVENT,
  LX_REQUEST_EVENT,
  LX_UPDATE_ALERT_EVENT,
  SANDBOX_INIT_TIMEOUT_MS,
  SANDBOX_LOG_LIMIT,
  SANDBOX_MAX_CONCURRENT_REQUESTS,
  type HostToSandboxMessage,
  type LxScriptMeta,
  type LxSourceDeclaration,
  type LxUpdateAlert,
  type SandboxToHostMessage,
  type SourceProxyPayload,
} from './protocol';
import { relaySourceRequest } from './relay';
import { buildRuntimeSource } from './runtime/runtimeSource';

export type SandboxStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** 音源管理页展示的沙箱状态快照。 */
export interface SandboxSnapshot {
  status: SandboxStatus;
  error: string;
  /** 脚本在 `inited` 里声明的平台能力（洛雪平台键：wy/tx/kw/kg/mg 等）。 */
  sources: Record<string, LxSourceDeclaration>;
  updateAlert: LxUpdateAlert | null;
  /** 脚本实际访问过的主机，用于提示用户这个音源在跟谁通信。 */
  hosts: string[];
  logs: string[];
  calls: SourceCallDiagnostic[];
}

export interface SandboxCallOutcome {
  ok: boolean;
  result: unknown;
  error: string;
}

export interface SandboxCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SandboxDependencies {
  createWorker: (url: string) => Worker;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  relay: typeof relaySourceRequest;
  appVersion: string;
}

/** 调用兜底超时：脚本内部的请求各有时限，这里只防止永久挂起。 */
const DEFAULT_CALL_TIMEOUT_MS = 20_000;

const defaultDependencies = (appVersion: string): SandboxDependencies => ({
  createWorker: (url) => new Worker(url),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  relay: relaySourceRequest,
  appVersion,
});

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

const isSourceProxyPayload = (value: unknown): value is SourceProxyPayload => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Record<string, unknown>;
  return typeof payload.url === 'string' && typeof payload.method === 'string'
    && typeof payload.bodyBase64 === 'string' && !!payload.headers
    && typeof payload.headers === 'object' && !Array.isArray(payload.headers)
    && Object.values(payload.headers).every((header) => typeof header === 'string');
};

/**
 * 单个音源脚本的沙箱：一个 Worker + 一份运行时 + 一条 RPC 通道。
 *
 * 一个脚本一个 Worker，脚本之间互不影响；`dispose` 会终止 Worker 并撤销 blob，
 * 因此停用/删除音源不会留下后台执行环境。
 */
export class LxSandbox {
  private readonly deps: SandboxDependencies;
  private readonly code: string;
  private readonly meta: LxScriptMeta;
  private worker: Worker | null = null;
  private runtimeUrl = '';
  private status: SandboxStatus = 'idle';
  private error = '';
  private sources: Record<string, LxSourceDeclaration> = {};
  private updateAlert: LxUpdateAlert | null = null;
  private readonly hosts = new Set<string>();
  private logs: string[] = [];
  private readonly callDiagnostics = new Map<string, SourceCallDiagnostic>();
  private readonly listeners = new Set<() => void>();
  private readonly pendingCalls = new Map<
    string,
    { settle: (outcome: SandboxCallOutcome) => void; timer: ReturnType<typeof setTimeout>;
      source: string; action: string; quality: string; startedAt: number }
  >();
  private readonly pendingRelays = new Map<string, AbortController>();
  private queue: Array<() => void> = [];
  private activeRequests = 0;
  private invokeSeq = 0;
  private initedSeen = false;
  private workerReadySeen = false;
  private loadedSeen = false;
  private initialization: Promise<void> | null = null;
  private finishInit: (() => void) | null = null;
  /** 该脚本自己的 cookie 会话（登录类音源需要）。 */
  private readonly cookieJar = new CookieJar();

  constructor(
    input: { code: string; meta: LxScriptMeta },
    deps: Partial<SandboxDependencies> = {},
  ) {
    this.code = input.code;
    this.meta = input.meta;
    this.deps = { ...defaultDependencies(input.meta.version || '0.0.0'), ...deps };
  }

  getSnapshot(): SandboxSnapshot {
    return {
      status: this.status,
      error: this.error,
      sources: { ...this.sources },
      updateAlert: this.updateAlert,
      hosts: [...this.hosts],
      logs: [...this.logs],
      calls: [...this.callDiagnostics.values()],
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 启动沙箱并等待脚本完成初始化。
   *
   * 失败（握手超时、脚本抛错、`inited` 前 Worker 崩溃）只反映在快照状态里，
   * 不向调用方抛异常：音源不可用不应该影响播放链路的其它分支。
   */
  async initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    if (!this.spawn()) return;
    // 实际下发脚本的时机在 Worker 回 `ready` 之后（见 handleWorkerMessage）。
    this.initialization = this.waitForInit();
    await this.initialization;
  }

  /** 调用脚本注册的处理器（action：musicUrl / lyric / pic）。 */
  async call(
    source: string,
    action: string,
    info: Record<string, unknown>,
    options: SandboxCallOptions = {},
  ): Promise<SandboxCallOutcome> {
    if (!this.worker || this.status !== 'ready') {
      return { ok: false, result: null, error: this.error || '沙箱不可用' };
    }
    if (options.signal?.aborted) throw abortReasonError(options.signal);

    this.invokeSeq += 1;
    const callId = `invoke-${this.invokeSeq}`;
    return new Promise<SandboxCallOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.settleCall(callId, { ok: false, result: null, error: '音源调用超时' });
      }, options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
      const onAbort = () => {
        if (this.pendingCalls.delete(callId)) {
          clearTimeout(timer);
          reject(abortReasonError(options.signal!));
        }
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      this.pendingCalls.set(callId, {
        source, action, quality: typeof info.type === 'string' ? info.type : '', startedAt: Date.now(),
        settle: (outcome) => {
          options.signal?.removeEventListener('abort', onAbort);
          resolve(outcome);
        },
        timer,
      });
      this.post({ kind: 'invoke', callId, event: LX_REQUEST_EVENT, payload: { source, action, info } });
    });
  }

  /** 中止该沙箱所有在途源请求（停用音源、重新加载时调用）。 */
  abortActiveRequests(): void {
    for (const controller of this.pendingRelays.values()) controller.abort();
    this.pendingRelays.clear();
  }

  dispose(): void {
    this.finishInit?.();
    this.cookieJar.clear();
    for (const [callId, entry] of this.pendingCalls) {
      clearTimeout(entry.timer);
      entry.settle({ ok: false, result: null, error: '沙箱已释放' });
      this.pendingCalls.delete(callId);
    }
    this.abortActiveRequests();
    this.queue = [];
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleWorkerMessage as EventListener);
      this.worker.removeEventListener('error', this.handleWorkerError as EventListener);
      this.worker.terminate();
      this.worker = null;
    }
    if (this.runtimeUrl) {
      this.deps.revokeObjectUrl(this.runtimeUrl);
      this.runtimeUrl = '';
    }
    this.status = this.status === 'failed' ? 'failed' : 'idle';
  }

  // ------------------------------------------------------------------ 内部

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  private appendLog(message: string): void {
    this.logs.push(message);
    if (this.logs.length > SANDBOX_LOG_LIMIT) this.logs.splice(0, this.logs.length - SANDBOX_LOG_LIMIT);
    this.notify();
  }

  private fail(message: string): void {
    this.status = 'failed';
    this.error = message;
    for (const callId of this.pendingCalls.keys()) {
      this.settleCall(callId, { ok: false, result: null, error: message });
    }
    this.dispose();
    this.appendLog(`[失败] ${message}`);
  }

  private spawn(): boolean {
    if (this.worker) return true;
    this.status = 'loading';
    try {
      const source = buildRuntimeSource({ appVersion: this.deps.appVersion });
      this.runtimeUrl = this.deps.createObjectUrl(new Blob([source], { type: 'text/javascript' }));
      this.worker = this.deps.createWorker(this.runtimeUrl);
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
      this.notify();
      return false;
    }
    this.worker.addEventListener('message', this.handleWorkerMessage as EventListener);
    this.worker.addEventListener('error', this.handleWorkerError as EventListener);
    this.notify();
    return true;
  }

  private post(message: HostToSandboxMessage): void {
    this.worker?.postMessage(message);
  }

  private waitForInit(): Promise<void> {
    if (!this.worker || this.initedSeen || this.status === 'failed') return Promise.resolve();
    return new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        unsubscribe();
        this.finishInit = null;
        resolve();
      };
      const unsubscribe = this.subscribe(() => {
        if (this.initedSeen || this.status === 'failed') finish();
      });
      const timer = setTimeout(() => {
        this.fail(this.loadedSeen
          ? '脚本未完成初始化（未收到 inited），请检查更新或诊断信息'
          : this.workerReadySeen ? '脚本执行超时（尚未完成加载）'
            : '沙箱初始化超时（Worker 未回握手）');
        finish();
      }, SANDBOX_INIT_TIMEOUT_MS);
      this.finishInit = finish;
    });
  }

  private settleCall(callId: string, outcome: SandboxCallOutcome): void {
    const entry = this.pendingCalls.get(callId);
    if (!entry) return;
    this.pendingCalls.delete(callId);
    clearTimeout(entry.timer);
    if (outcome.ok && entry.action === 'musicUrl' && !readSourceUrl(outcome.result)) {
      outcome = { ok: false, result: null, error: '解析结果格式错误：未返回有效的 HTTP(S) 播放地址' };
    }
    const message = outcome.ok ? '返回结果有效' : outcome.error || '音源调用失败';
    this.callDiagnostics.set(`${entry.source}:${entry.action}`, {
      source: entry.source, action: entry.action, quality: entry.quality, ok: outcome.ok,
      message, durationMs: Date.now() - entry.startedAt, checkedAt: Date.now(),
    });
    this.appendLog(`[${outcome.ok ? '调用成功' : '调用失败'}] ${entry.source} · ${entry.action}${entry.quality ? ` · ${entry.quality}` : ''}：${message}`);
    entry.settle(outcome);
  }

  private handleSend(event: string, data: unknown): void {
    if (event === LX_INITED_EVENT) {
      const payload = (data || {}) as Record<string, unknown>;
      if (payload.status === false) {
        this.fail(typeof payload.message === 'string' ? payload.message : '脚本初始化失败');
        return;
      }
      this.sources = normalizeSources(payload.sources);
      if (!Object.entries(this.sources).some(([platform, declaration]) => declarationPlatform(platform, declaration))) {
        this.fail('脚本没有声明可用的平台与操作，请检查声明格式或更新音源');
        return;
      }
      this.initedSeen = true;
      this.status = 'ready';
      this.error = '';
      this.appendLog(
        `[已加载] 声明平台：${Object.keys(this.sources).join(' / ')}；尚未验证解析`,
      );
      return;
    }
    if (event === LX_UPDATE_ALERT_EVENT) {
      this.updateAlert = normalizeUpdateAlert(data);
      this.notify();
      return;
    }
    this.appendLog(`[事件] ${event}`);
  }

  private handleRequest(callId: string, payload: SourceProxyPayload): void {
    if (typeof callId !== 'string' || !callId) return;
    if (!isSourceProxyPayload(payload)) {
      this.post({ kind: 'reply', callId, error: '音源请求格式无效' });
      return;
    }
    const host = hostOf(payload.url);
    if (host && !this.hosts.has(host)) {
      this.hosts.add(host);
      this.notify();
    }
    // 脚本自己设了 Cookie 头时以它为准，否则补上本脚本会话里的 cookie。
    const outgoing = this.withSessionCookies(payload);
    this.enqueue(async () => {
      const controller = new AbortController();
      this.pendingRelays.set(callId, controller);
      try {
        const result = await this.deps.relay(outgoing, controller.signal);
        if ('envelope' in result) {
          if (result.envelope.status >= 400) this.appendLog(`[请求失败] ${host} · HTTP ${result.envelope.status}`);
          this.cookieJar.store(outgoing.url, result.envelope.cookies ?? []);
          this.post({ kind: 'reply', callId, envelope: result.envelope });
        } else {
          this.appendLog(`[请求失败] ${host}：${result.error}`);
          this.post({ kind: 'reply', callId, error: result.error });
        }
      } catch (error) {
        if (controller.signal.aborted) {
          this.post({ kind: 'reply', callId, error: '请求已取消' });
        } else {
          this.post({
            kind: 'reply',
            callId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        this.pendingRelays.delete(callId);
      }
    });
  }

  /** 出站请求补上会话 cookie（不覆盖脚本显式设置的 Cookie 头）。 */
  private withSessionCookies(payload: SourceProxyPayload): SourceProxyPayload {
    const existing = Object.keys(payload.headers).some((name) => name.toLowerCase() === 'cookie');
    if (existing) return payload;
    const cookie = this.cookieJar.headerFor(payload.url);
    if (!cookie) return payload;
    return { ...payload, headers: { ...payload.headers, cookie } };
  }

  private enqueue(task: () => Promise<void>): void {
    const run = () => {
      this.activeRequests += 1;
      void task().finally(() => {
        this.activeRequests -= 1;
        const next = this.queue.shift();
        if (next) next();
      });
    };
    if (this.activeRequests < SANDBOX_MAX_CONCURRENT_REQUESTS) run();
    else this.queue.push(run);
  }

  private handleWorkerMessage = (event: MessageEvent): void => {
    const message = event.data as SandboxToHostMessage | null;
    if (!message || typeof message !== 'object') return;
    switch (message.kind) {
      case 'ready':
        this.workerReadySeen = true;
        this.post({ kind: 'load', code: this.code, meta: this.meta });
        return;
      case 'loaded':
        this.loadedSeen = true;
        return;
      case 'load-error':
        this.fail(`脚本加载失败：${message.message}`);
        this.notify();
        return;
      case 'send':
        this.handleSend(message.event, message.data);
        return;
      case 'request':
        this.handleRequest(message.callId, message.payload);
        return;
      case 'invoke-result':
        this.settleCall(message.callId, { ok: true, result: message.result, error: '' });
        return;
      case 'invoke-error':
        this.settleCall(message.callId, { ok: false, result: null, error: message.message });
        return;
      case 'console':
        this.appendLog(`[${message.level}] ${message.message}`);
        return;
      case 'error':
        this.appendLog(`[错误] ${message.message}`);
        return;
      default:
        return;
    }
  };

  private handleWorkerError = (event: ErrorEvent): void => {
    const message = event.message || '沙箱运行期错误';
    this.fail(message);
    this.notify();
  };
}
