/**
 * Typed command facade over `invoke`.
 * The keys of `CommandMap` must stay a literal, bidirectional mirror of the
 * `tauri::generate_handler![...]` list in `src-tauri/src/app/bootstrap.rs`
 * (`scripts/check-ipc-contract.mjs` diffs both sides).
 */

import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { toIpcError } from "./error";
import type { Song } from "../types";
import type {
  AvailableUpdate,
  DownloadedFileResult,
  DownloadMetadataInput,
  LibrarySnapshot,
  LlmConfigInput,
  LlmConfigView,
  LlmProviderTestResult,
  LocalServerInfo,
  OfflineDownloadMeta,
  RecommendationEvent,
  RecommendationFeedback,
  RecommendationItem,
  RecommendationJob,
  RecommendationMaintenanceStats,
  ResolvedPlayback,
} from "./types";

export interface CommandMap {
  download_song_to_local: {
    args: { url: string; filename: string; taskId: string; metadata: DownloadMetadataInput };
    result: DownloadedFileResult;
  };
  cancel_download: { args: { taskId: string }; result: boolean };
  scan_download_dir: { args: void; result: OfflineDownloadMeta[] };
  delete_download_file: { args: { filename: string }; result: void };
  resolve_local_playback: {
    args: { songId: string; source: string; quality?: string };
    result: ResolvedPlayback | null;
  };
  relay_player_control: {
    args: { action: string; value?: unknown };
    result: void;
  };
  open_external_url: { args: { url: string }; result: void };
  open_download_dir: { args: void; result: void };
  get_download_dir: { args: void; result: string };
  get_default_download_dir: { args: void; result: string };
  reset_download_dir: { args: void; result: string };
  select_download_dir: { args: void; result: string | null };
  check_for_update: { args: void; result: AvailableUpdate | null };
  download_and_install_update: { args: void; result: void };
  get_local_server_info: { args: void; result: LocalServerInfo };
  mark_frontend_ready: { args: void; result: void };
  log_recommendation_event: {
    args: { event: RecommendationEvent };
    result: void;
  };
  sync_recommendation_library: {
    args: { snapshot: LibrarySnapshot };
    result: boolean;
  };
  get_similar_songs: {
    args: { song: Song; limit?: number };
    result: RecommendationItem[];
  };
  get_recommendation_job: {
    args: { jobId: string };
    result: RecommendationJob | null;
  };
  get_latest_recommendation_job: {
    args: void;
    result: RecommendationJob | null;
  };
  dismiss_recommendation: {
    args: { song: Song; reason?: string };
    result: void;
  };
  save_recommendation_feedback: {
    args: { feedback: RecommendationFeedback };
    result: void;
  };
  rebuild_recommendation_index: { args: void; result: void };
  get_llm_config: { args: void; result: LlmConfigView };
  save_llm_config: { args: { config: LlmConfigInput }; result: void };
  test_llm_provider: {
    args: { config?: LlmConfigInput };
    result: LlmProviderTestResult;
  };
  clear_recommendation_data: {
    args: void;
    result: RecommendationMaintenanceStats;
  };
  quit_app: { args: void; result: void };
  mark_desktop_lyric_ready: { args: void; result: void };
  show_desktop_lyric_window: { args: { lock: boolean }; result: void };
  set_desktop_lyric_lock: { args: { lock: boolean }; result: void };
  hide_desktop_lyric_window: { args: void; result: void };
}

export async function invokeCommand<K extends keyof CommandMap>(
  command: K,
  args?: CommandMap[K]["args"],
): Promise<CommandMap[K]["result"]> {
  try {
    return await invoke<CommandMap[K]["result"]>(
      command,
      (args ?? undefined) as InvokeArgs | undefined,
    );
  } catch (error) {
    throw toIpcError(error);
  }
}
