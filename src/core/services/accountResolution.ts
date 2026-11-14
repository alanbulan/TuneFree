import { invokeCommand, isTauri, toIpcError, type PlatformAccountPlayback } from '../ipc';
import { ACCOUNT_PLATFORMS } from './platformAccounts';
import { createLinkedAbort, throwIfAborted } from './proxy';
import type { SourceResolveRequest } from './sources/types';

/** Account resolution precedes both script URL and script full-song paths. */
export async function resolveAccountUrl(request: SourceResolveRequest): Promise<PlatformAccountPlayback | null> {
  throwIfAborted(request.signal);
  if (!isTauri() || !ACCOUNT_PLATFORMS.some((platform) => platform.id === request.platform)) return null;
  // Includes vault/IPC wait as well as the native resolver's 12s network budget.
  const linked = createLinkedAbort(request.signal, 14_000);
  let detach = () => {};
  try {
    const cancelled = new Promise<never>((_resolve, reject) => {
      const onAbort = () => {
        try { throwIfAborted(linked.signal); } catch (error) { reject(error); }
      };
      linked.signal.addEventListener('abort', onAbort, { once: true });
      detach = () => linked.signal.removeEventListener('abort', onAbort);
    });
    const result = await Promise.race([cancelled, invokeCommand('resolve_platform_account_url', {
      platform: request.platform, songId: String(request.id), quality: request.quality,
      ...(request.strMediaMid ? { mediaMid: request.strMediaMid } : {}),
      ...(request.rejectedUrls?.length ? { rejectedUrls: [...request.rejectedUrls] } : {}),
    })]);
    throwIfAborted(request.signal);
    return result;
  } catch (error) {
    throwIfAborted(request.signal);
    const parsed = toIpcError(error);
    return { url: null, quality: null, state: 'unavailable', message: linked.signal.aborted
      ? '账号解析超时，请在账号页检查登录状态或系统凭据权限' : parsed.message };
  } finally { detach(); linked.cleanup(); }
}
