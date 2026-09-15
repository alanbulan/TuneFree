import { API_PREFIX, buildLocalServerHeaders } from '../config';
import { abortReasonError } from '../resolverMatch';

/**
 * 内置平台（网易 / QQ / 酷我）的播放地址解析：请求本地服务的 `/api/url`。
 *
 * 从 `resolver.ts` 抽出到独立模块，避免「provider 注册表 ← resolver」的循环依赖。
 */

const NATIVE_URL_TIMEOUT_MS = 8_000;

const readJsonBody = async (resp: Response): Promise<any> => {
  try {
    return await resp.json();
  } catch {
    return null;
  }
};

export const fetchNativeUrl = async (
  id: string,
  platform: string,
  quality: string,
  signal?: AbortSignal,
): Promise<string | null> => {
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => controller.abort(), NATIVE_URL_TIMEOUT_MS);
  try {
    const resp = await fetch(
      `${API_PREFIX}/api/url?platform=${encodeURIComponent(platform)}&id=${encodeURIComponent(id)}&quality=${encodeURIComponent(quality)}`,
      { signal: controller.signal, headers: buildLocalServerHeaders() },
    );
    const data = await readJsonBody(resp);
    if (signal?.aborted) throw abortReasonError(signal);
    // 后端 /api/url 失败时会返回结构化 error 字段，必须落日志，
    // 否则代理白名单 403 与"平台不可用"完全不可区分。
    const detail = typeof data?.error === "string" ? `：${data.error}` : "";
    if (resp.ok) {
      if (data?.url) return data.url as string;
      console.warn(`[Resolver] /api/url 未返回可用链接 (${platform}:${id})${detail}`);
    } else {
      console.warn(
        `[Resolver] /api/url 请求失败 (${platform}:${id}) HTTP ${resp.status}${detail}`,
      );
    }
  } catch {
    if (signal?.aborted) throw abortReasonError(signal);
    // native resolver unavailable
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromCaller);
  }
  return null;
};
