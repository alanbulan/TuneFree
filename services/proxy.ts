import { DEFAULT_API_BASE, DEFAULT_PROXIES, SELF_HOSTED_PROXY } from "./config";

// ==============================
// localStorage 读取工具
// ==============================

export const getStoredApiKey = (): string =>
  localStorage.getItem("tunefree_api_key") || "";

export const getStoredProxy = (): string | null =>
  localStorage.getItem("tunefree_cors_proxy") || null;

/**
 * 获取代理列表 — 自建代理始终排第一位。
 * 若用户未配置代理或配置了自建代理，直接返回默认列表（自建 + corsproxy.io 兜底）；
 * 若用户配置了第三方代理，自建代理仍排第一，自定义代理作为备用。
 */
export const getProxies = (): string[] => {
  const stored = localStorage.getItem("tunefree_cors_proxy");
  if (!stored) return DEFAULT_PROXIES;
  if (stored === SELF_HOSTED_PROXY) return DEFAULT_PROXIES;
  return [SELF_HOSTED_PROXY, stored];
};

/**
 * 获取存储的 API Base，末尾斜杠会被移除，防止拼接时出现双斜杠。
 */
export const getStoredApiBase = (): string => {
  let base =
    localStorage.getItem("tunefree_api_base") || DEFAULT_API_BASE;
  if (base.endsWith("/")) base = base.slice(0, -1);
  return base;
};

// ==============================
// 代理请求核心工具
// ==============================

/**
 * 通过代理列表发起 GET 请求，自动解析 JSON（兼容 JSONP 包裹格式）。
 * 自建代理（同源请求）不设 mode: 'cors'，避免 CF 透传头引发 CORS 预检失败。
 */
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
      /* 继续下一个代理 */
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
      /* 继续下一个代理 */
    }
  }

  return null;
};

/**
 * 通过代理列表发起请求，遍历所有代理，对每个代理的响应执行 validator 校验，
 * 返回第一个校验通过的 JSON 数据。适用于 QQ 音乐等需要 POST 且需结构校验的场景。
 */
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
        /* skip unparsable response */
      }

      if (data && validator(data)) return data as T;
    } catch {
      /* 继续下一个代理 */
    }
  }

  return null;
};
