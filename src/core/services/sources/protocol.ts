/**
 * 沙箱（Worker）与父窗口之间的消息协议，以及与 Rust `/api/source-proxy` 的信封类型。
 *
 * 这里只放类型与常量：运行时片段在 `runtime/`，宿主实现在 `workerHost.ts`。
 */

/** 脚本在 `inited` 里声明的某一个平台能力（洛雪格式）。 */
export interface LxSourceDeclaration {
  name?: string;
  type?: string;
  actions?: string[];
  qualitys?: string[];
}

/** 从脚本文本头部解析出的身份信息，同时会注入沙箱的 `lx.currentScriptInfo`。 */
export interface LxScriptMeta {
  name: string;
  description: string;
  version: string;
  author: string;
  homepage: string;
}

/** 脚本向父窗口上报的升级提示。 */
export interface LxUpdateAlert {
  log: string;
  updateUrl?: string;
}

/** 父窗口 → Worker。 */
export type HostToSandboxMessage =
  | { kind: 'load'; code: string; meta: LxScriptMeta }
  | {
      kind: 'invoke';
      callId: string;
      event: string;
      payload: { source: string; action: string; info: Record<string, unknown> };
    }
  | { kind: 'reply'; callId: string; envelope?: SourceProxyEnvelope; error?: string }
  | { kind: 'ping' };

/** Worker → 父窗口。 */
export type SandboxToHostMessage =
  | { kind: 'ready'; version: string }
  | { kind: 'loaded' }
  | { kind: 'load-error'; message: string }
  | { kind: 'send'; event: string; data: unknown }
  | { kind: 'request'; callId: string; payload: SourceProxyPayload }
  | { kind: 'invoke-result'; callId: string; result: unknown }
  | { kind: 'invoke-error'; callId: string; message: string }
  | { kind: 'console'; level: string; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'pong' };

/** 与 Rust `SourceProxyRequest` 一一对应的请求信封。 */
export interface SourceProxyPayload {
  url: string;
  method: string;
  headers: Record<string, string>;
  bodyBase64: string;
  timeoutMs?: number;
  binary?: boolean;
}

/** 与 Rust `SourceProxyResponse` 一一对应的响应信封。 */
export interface SourceProxyEnvelope {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  cookies?: string[];
  bodyBase64: string;
}

/** 洛雪脚本被调用的事件名。 */
export const LX_REQUEST_EVENT = 'request';
export const LX_INITED_EVENT = 'inited';
export const LX_UPDATE_ALERT_EVENT = 'updateAlert';

/** 沙箱初始化（握手 + 加载脚本 + 首个 inited）的时间上限。 */
export const SANDBOX_INIT_TIMEOUT_MS = 10_000;
/** 单个沙箱同时进行的源请求上限。 */
export const SANDBOX_MAX_CONCURRENT_REQUESTS = 6;
/** 保留的日志条数，供音源管理页排查。 */
export const SANDBOX_LOG_LIMIT = 50;
