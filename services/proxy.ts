import { DEFAULT_PROXIES, SELF_HOSTED_PROXY } from "./config";

export const getProxies = (): string[] => {
  const stored = localStorage.getItem("tunefree_cors_proxy");
  if (!stored || stored === SELF_HOSTED_PROXY) return DEFAULT_PROXIES;
  return [SELF_HOSTED_PROXY, stored];
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
