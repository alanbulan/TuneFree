/**
 * Structured IPC error contract shared by every `#[tauri::command]`.
 * The Rust side serializes `CommandError` as `{ code, message }`;
 * `toIpcError` normalizes whatever `invoke` rejects with into `IpcError`.
 */

const IPC_ERROR_CODES = [
  "INTERNAL",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "IO",
  "NETWORK",
  "CANCELLED",
  "TIMEOUT",
  "BUSY",
  "DATABASE",
  "DOWNLOAD_DIR_UNAUTHORIZED",
  "DOWNLOAD_DIR_INVALID",
  "DOWNLOAD_FAILED",
  "UNSUPPORTED_PLATFORM",
  "WINDOW_UNAVAILABLE",
  "UPDATE_FAILED",
  "RECOMMENDATION_DISABLED",
  "LLM_CONFIG_INVALID",
  "LLM_REQUEST_FAILED",
  "CREDENTIAL_UNAVAILABLE",
] as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[number];

export class IpcError extends Error {
  readonly code: IpcErrorCode;

  constructor(code: IpcErrorCode, message: string) {
    super(message);
    this.name = "IpcError";
    this.code = code;
  }
}

const isIpcErrorCode = (value: unknown): value is IpcErrorCode =>
  typeof value === "string" &&
  (IPC_ERROR_CODES as readonly string[]).includes(value);

/** 把 invoke 抛出的任意值规整为 IpcError；无法识别时回落到 INTERNAL。 */
export const toIpcError = (error: unknown): IpcError => {
  if (error instanceof IpcError) return error;

  if (typeof error === "string") {
    return new IpcError("INTERNAL", error || "未知错误");
  }

  if (error && typeof error === "object") {
    const { code, message } = error as { code?: unknown; message?: unknown };
    const text =
      typeof message === "string" && message ? message : "未知错误";
    if (isIpcErrorCode(code)) return new IpcError(code, text);
    if (error instanceof Error) {
      return new IpcError("INTERNAL", error.message || "未知错误");
    }
    if (typeof message === "string") return new IpcError("INTERNAL", text);
  }

  return new IpcError("INTERNAL", `未知错误: ${String(error)}`);
};
