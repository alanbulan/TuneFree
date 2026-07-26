import { IpcError, toIpcError } from '../../../core/ipc';

export type FeedbackTone = 'error' | 'warning' | 'info';

export interface IpcFeedback {
  /** `null` 表示该错误应被静默吞掉（例如用户主动取消）。 */
  message: string | null;
  tone: FeedbackTone;
  /** 下载目录失效，调用方应引导用户重新选择目录。 */
  needsDirectoryReselect: boolean;
  /** 后端尚未就绪，调用方可以退避后重试。 */
  busy: boolean;
  /** 网络/超时类错误，重试大概率能成功。 */
  retryable: boolean;
}

const feedback = (
  message: string | null,
  tone: FeedbackTone,
  flags: Partial<Pick<IpcFeedback, 'needsDirectoryReselect' | 'busy' | 'retryable'>> = {},
): IpcFeedback => ({
  message,
  tone,
  needsDirectoryReselect: flags.needsDirectoryReselect ?? false,
  busy: flags.busy ?? false,
  retryable: flags.retryable ?? false,
});

/**
 * Maps a structured `CommandError` onto the toast treatment it deserves.
 * The backend already ships user-facing Chinese messages, so `message` is
 * reused verbatim and only the actionable suffix / tone is decided here.
 */
export const describeIpcFailure = (error: unknown, fallback: string): IpcFeedback => {
  const ipcError = error instanceof IpcError ? error : toIpcError(error);
  const message = ipcError.message || fallback;

  switch (ipcError.code) {
    case 'CANCELLED':
      return feedback(null, 'info');
    case 'DOWNLOAD_DIR_UNAUTHORIZED':
    case 'DOWNLOAD_DIR_INVALID':
      return feedback(`${message}，请重新选择下载目录`, 'error', { needsDirectoryReselect: true });
    case 'NETWORK':
    case 'TIMEOUT':
      return feedback(`${message}，请检查网络后重试`, 'warning', { retryable: true });
    case 'CREDENTIAL_UNAVAILABLE':
      return feedback(`${message}（当前平台不支持该能力）`, 'warning');
    case 'BUSY':
      return feedback(message, 'info', { busy: true });
    default:
      return feedback(message, 'error');
  }
};

export const isBusyIpcError = (error: unknown): boolean =>
  error instanceof IpcError && error.code === 'BUSY';

/** 推荐服务初始化期返回 BUSY 时的退避间隔与次数上限（契约 §7.7）。 */
export const busyRetryDelayMs = 500;
export const maxBusyRetries = 8;

const defaultWait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Retries a command while the backend still reports `BUSY`, i.e. while the
 * recommendation service is opening its database on a background thread.
 * `onBusy` fires on every backoff so the caller can surface a hint.
 */
export async function retryWhileBusy<T>(
  run: () => Promise<T>,
  onBusy?: () => void,
  wait: (ms: number) => Promise<void> = defaultWait,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isBusyIpcError(error) || attempt >= maxBusyRetries) throw error;
      onBusy?.();
      await wait(busyRetryDelayMs);
    }
  }
}
