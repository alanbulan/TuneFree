/**
 * Typed event facade over `@tauri-apps/api/event`.
 * Every event that crosses windows (or Rust → webview) must be declared here
 * so listeners and emitters share one payload contract.
 */

import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  DownloadProgressPayload,
  LyricSongPayload,
  LyricTickPayload,
  PlayerControlPayload,
  RecommendationJobUpdatePayload,
  ThemeChangedPayload,
  UpdateProgressPayload,
} from "./types";

export interface EventMap {
  "lyric-song": LyricSongPayload;
  "lyric-tick": LyricTickPayload;
  "player-control": PlayerControlPayload;
  "theme-changed": ThemeChangedPayload;
  "download-progress": DownloadProgressPayload;
  "update-progress": UpdateProgressPayload;
  "recommendation-job-update": RecommendationJobUpdatePayload;
  "desktop-lyric-closed": void;
  /** 歌词窗口首帧渲染就绪（供主窗口补发 lyric-song / lyric-tick）。 */
  "desktop-lyric-ready": void;
  /** 歌词窗口锁定状态同步（Rust `set_desktop_lyric_lock` 触发）。 */
  "lock-change": boolean;
}

export type { UnlistenFn };

export function listenEvent<K extends keyof EventMap>(
  event: K,
  handler: (payload: EventMap[K]) => void,
): Promise<UnlistenFn> {
  return listen<EventMap[K]>(event, (raw) => handler(raw.payload));
}

/** 定向发送事件到指定窗口（如 "desktop-lyric" / "main"），禁止用广播 emit。 */
export function emitEventTo<K extends keyof EventMap>(
  targetWindow: string,
  event: K,
  payload: EventMap[K],
): Promise<void> {
  return emitTo(targetWindow, event, payload);
}
