/**
 * Thin re-exports for window handles and asset URL conversion so that
 * feature code never imports `@tauri-apps/api` directly (architecture guard).
 */

export { getCurrentWindow } from "@tauri-apps/api/window";
export type { Window } from "@tauri-apps/api/window";
export { convertFileSrc } from "@tauri-apps/api/core";
export { getVersion } from "@tauri-apps/api/app";
