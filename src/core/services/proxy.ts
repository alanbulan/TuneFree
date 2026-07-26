import {
  buildLocalServerHeaders,
  DEFAULT_PROXIES,
  SELF_HOSTED_PROXY,
} from "./config";

export const isLocalServerProxy = (value: string): boolean => {
  try {
    const url = new URL(value);
    const isLoopback =
      url.hostname === "127.0.0.1" ||
      url.hostname === "localhost" ||
      url.hostname === "[::1]";
    return (
      url.protocol === "http:" &&
      isLoopback &&
      url.pathname === "/api/cors-proxy" &&
      url.searchParams.has("url")
    );
  } catch {
    return false;
  }
};

/**
 * 获取代理列表 — 自建代理始终排第一位。
 * 若用户未配置代理或配置了自建代理，直接返回默认列表；
 * 若用户配置了第三方代理，自建代理仍排第一，自定义代理作为备用。
 */
export const getProxies = (): string[] => {
  const stored =
    typeof window === "undefined"
      ? null
      : localStorage.getItem("tunefree_cors_proxy");
  if (!stored) return DEFAULT_PROXIES;
  if (stored === SELF_HOSTED_PROXY || isLocalServerProxy(stored)) {
    return DEFAULT_PROXIES;
  }
  if (stored.includes('corsproxy.io')) return DEFAULT_PROXIES;
  return [SELF_HOSTED_PROXY, stored];
};

// ==============================
// 代理请求核心工具
// ==============================

/** 把调用方 signal 与超时合并成一个请求级 signal，cleanup 负责解绑。 */
export const createLinkedAbort = (
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', abortFromCaller);
    },
  };
};

/** 调用方主动取消时把 abort 原因往上抛，避免被当作"代理失败"吞掉。 */
export const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError');
};

const describeTargetHost = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * 403（代理白名单拒绝/平台风控）与 429（限流）必须可观测，
 * 否则与"平台不可用"完全不可区分。
 */
const warnDegradedResponse = (targetUrl: string, status: number): void => {
  if (status === 403 || status === 429 || status >= 500) {
    console.warn(
      `[Proxy] 目标 ${describeTargetHost(targetUrl)} 响应 HTTP ${status}` +
        '（403=代理白名单拒绝或平台风控，429=限流）',
    );
  }
};

const buildProxyRequestInit = (
  isSelfProxy: boolean,
  options: RequestInit,
  signal: AbortSignal,
): RequestInit => {
  const init: RequestInit = {
    ...options,
    credentials: "omit",
    signal,
  };
  if (isSelfProxy) {
    const headers = new Headers(options.headers);
    for (const [key, value] of Object.entries(buildLocalServerHeaders())) {
      headers.set(key, value);
    }
    init.headers = headers;
    delete init.mode;
  } else {
    // 自建代理（同源请求）不设 mode: 'cors'，避免 CF 透传头引发 CORS 预检失败。
    init.mode = "cors";
  }
  return init;
};

/**
 * 通过代理列表发起 GET 请求，自动解析 JSON（兼容 JSONP 包裹格式）。
 */
export const proxyFetchJson = async (
  url: string,
  timeoutMs = 8000,
  signal?: AbortSignal,
): Promise<any> => {
  const proxies = getProxies();

  for (const proxy of proxies) {
    const linked = createLinkedAbort(signal, timeoutMs);
    try {
      const finalUrl = `${proxy}${encodeURIComponent(url)}`;
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(
        finalUrl,
        buildProxyRequestInit(isSelfProxy, {}, linked.signal),
      );
      if (!resp.ok) warnDegradedResponse(url, resp.status);

      const text = await resp.text();
      let data: any = null;

      try {
        data = JSON.parse(text);
      } catch {
        // JSONP 兜底：MusicJsonCallback({...}) 或 callback({...})
        const m = text.match(/^\s*[\w.]+\s*\((.*)\)\s*;?\s*$/s);
        if (m) {
          try {
            data = JSON.parse(m[1]);
          } catch {
            /* skip */
          }
        }
      }

      if (data) return data;
    } catch {
      throwIfAborted(signal);
      /* 继续下一个代理 */
    } finally {
      linked.cleanup();
    }
  }

  return null;
};

/**
 * 通过代理列表发起请求（支持 GET / POST），返回原始 Response 对象。
 * 调用方负责读取 response.text() / response.json()。
 * 成功时返回第一个可用代理的 Response；全部失败时返回 null。
 */
export const proxyFetch = async (
  url: string,
  options: Omit<RequestInit, "credentials" | "mode"> = {},
  timeoutMs = 8000,
): Promise<Response | null> => {
  const proxies = getProxies();
  let lastResp: Response | null = null;

  for (const proxy of proxies) {
    const linked = createLinkedAbort(options.signal ?? undefined, timeoutMs);
    try {
      const finalUrl = `${proxy}${encodeURIComponent(url)}`;
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(
        finalUrl,
        buildProxyRequestInit(isSelfProxy, options, linked.signal),
      );

      if (resp.ok) {
        return resp;
      }

      warnDegradedResponse(url, resp.status);
      lastResp = resp;
    } catch {
      throwIfAborted(options.signal ?? undefined);
      /* 继续下一个代理 */
    } finally {
      linked.cleanup();
    }
  }

  return lastResp;
};

/**
 * 通过代理列表发起请求，遍历所有代理，对每个代理的响应执行 validator 校验，
 * 返回第一个校验通过的 JSON 数据。适用于 QQ 音乐等需要 POST 且需结构校验的场景。
 */
export const proxyFetchJsonWithValidator = async <T = any>(
  url: string,
  options: Omit<RequestInit, "credentials" | "mode"> = {},
  validator: (data: any) => boolean = () => true,
  timeoutMs = 8000,
): Promise<T | null> => {
  const proxies = getProxies();

  for (const proxy of proxies) {
    const linked = createLinkedAbort(options.signal ?? undefined, timeoutMs);
    try {
      const finalUrl = `${proxy}${encodeURIComponent(url)}`;
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(
        finalUrl,
        buildProxyRequestInit(isSelfProxy, options, linked.signal),
      );
      if (!resp.ok) warnDegradedResponse(url, resp.status);

      let data: any = null;
      try {
        data = await resp.json();
      } catch {
        /* skip unparsable response */
      }

      if (data && validator(data)) return data as T;
    } catch {
      throwIfAborted(options.signal ?? undefined);
      /* 继续下一个代理 */
    } finally {
      linked.cleanup();
    }
  }

  return null;
};
