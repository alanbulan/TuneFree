import { buildLocalServerHeaders, getLocalServerBase } from '../config';
import { isTauri } from '../../ipc/env';
import type { SourceProxyEnvelope, SourceProxyPayload } from './protocol';

/** 源代理请求的整体超时（毫秒）；沙箱自己也会带 `timeoutMs`。 */
const RELAY_TIMEOUT_MS = 60_000;

export type RelayResult = { envelope: SourceProxyEnvelope } | { error: string };

const describeFailure = (data: unknown, status: number): string => {
  if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return `源代理请求失败（HTTP ${status}）`;
};

const isEnvelope = (data: unknown): data is SourceProxyEnvelope => {
  if (!data || typeof data !== 'object') return false;
  const candidate = data as Partial<SourceProxyEnvelope>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.bodyBase64 === 'string' &&
    typeof candidate.headers === 'object'
  );
};

/**
 * 父窗口侧把沙箱请求转发到 Rust `/api/source-proxy`。
 *
 * 之所以绕到本地服务而不是浏览器 fetch：脚本需要设置 `User-Agent`/`Referer`/`Cookie`
 * 这些浏览器禁止头，并且响应里的 `set-cookie` 在页面里读不到；同时 Rust 侧统一做
 * 「仅公网目标」的 SSRF 管控。
 */
export const relaySourceRequest = async (
  payload: SourceProxyPayload,
  signal?: AbortSignal,
): Promise<RelayResult> => {
  if (!isTauri()) {
    // 纯浏览器 dev 环境没有本地服务，自定义音源无法工作，这里给出明确原因。
    return { error: '自定义音源需要在桌面应用中运行（浏览器环境没有本地源代理）' };
  }

  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), RELAY_TIMEOUT_MS);
  const abortFromCaller = () => timeout.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetch(`${getLocalServerBase()}/api/source-proxy`, {
      method: 'POST',
      headers: { ...buildLocalServerHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({
        url: payload.url,
        method: payload.method,
        headers: payload.headers,
        bodyBase64: payload.bodyBase64,
        timeoutMs: payload.timeoutMs,
      }),
      credentials: 'omit',
      signal: timeout.signal,
    });
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) return { error: describeFailure(data, response.status) };
    if (!isEnvelope(data)) return { error: '源代理返回的信封格式不正确' };
    return { envelope: data };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.signal.aborted) return { error: '源代理请求超时' };
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
};
