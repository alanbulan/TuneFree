import { DEFAULT_PROXIES, SELF_HOSTED_PROXY } from "./config";

export const getProxies = (): string[] => {
  const stored = localStorage.getItem("tunefree_cors_proxy");
  if (!stored || stored === SELF_HOSTED_PROXY) return DEFAULT_PROXIES;
  return [SELF_HOSTED_PROXY, stored];
};

/**
 * 直连优先、代理兜底的 fetch。
 *
 * GD Studio 自带 CORS 头（`access-control-allow-origin: *`），浏览器可以直连；
 * 而经 Pages 自建代理转发时，它拒绝来自 Cloudflare 出口 IP 的请求——三个 Pages
 * 部署实测全部返回 520，同一份代理代码在本地 workerd 用普通出口访问却正常。
 * 因此先直连（用用户自己的出口 IP），只有直连抛错（跨域被拦 / 网络不可达）
 * 才退回代理。
 */
export const directFirstFetch = async (
  url: string,
  timeoutMs = 12000,
): Promise<Response | null> => {
  // 直连失败通常是一次性的：GD Studio 的风控响应不带 CORS 头时，浏览器只会报
  // ERR_FAILED，同一秒重发就能拿到正常响应（线上实测已出现）。直接退回代理在
  // 线上必然是 520，所以先重试一次再退。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, {
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return resp;
    } catch {
      /* 再试一次 */
    }
  }

  return proxyFetch(url, {}, timeoutMs);
};

export const proxyFetchJson = async (
  url: string,
  timeoutMs = 8000,
): Promise<any> => {
  const proxies = getProxies();

  for (const proxy of proxies) {
    try {
      const finalUrl = `${proxy}${encodeURIComponent(url)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(finalUrl, {
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const text = await resp.text();
      let data: any = null;

      try {
        data = JSON.parse(text);
      } catch {
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
      /* continue */
    }
  }

  return null;
};

export const proxyFetch = async (
  url: string,
  options: Omit<RequestInit, "signal" | "credentials" | "mode"> = {},
  timeoutMs = 8000,
): Promise<Response | null> => {
  const proxies = getProxies();

  for (const proxy of proxies) {
    try {
      const finalUrl = `${proxy}${encodeURIComponent(url)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(finalUrl, {
        ...options,
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      return resp;
    } catch {
      /* continue */
    }
  }

  return null;
};

export const proxyFetchJsonWithValidator = async <T = any>(
  url: string,
  options: Omit<RequestInit, "signal" | "credentials" | "mode"> = {},
  validator: (data: any) => boolean = () => true,
  timeoutMs = 8000,
): Promise<T | null> => {
  const proxies = getProxies();

  for (const proxy of proxies) {
    try {
      const finalUrl = `${proxy}${encodeURIComponent(url)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const isSelfProxy = proxy === SELF_HOSTED_PROXY;

      const resp = await fetch(finalUrl, {
        ...options,
        ...(isSelfProxy ? {} : { mode: "cors" as RequestMode }),
        credentials: "omit",
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let data: any = null;
      try {
        data = await resp.json();
      } catch {
        /* skip */
      }

      if (data && validator(data)) return data as T;
    } catch {
      /* continue */
    }
  }

  return null;
};
