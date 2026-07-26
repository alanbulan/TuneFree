/** 是否运行在 Tauri 宿主中（全项目唯一实现，禁止各处自行探测）。 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
