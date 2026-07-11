import React, { createContext, useContext } from "react";
import type {
  PlayerActions,
  PlayerAnalyser,
  PlayerContextValue,
  PlayerNoticeState,
  PlayerNowPlaying,
  PlayerProgress,
  PlayerQueueState,
  PlayerSettings,
} from "../player/types";
import { usePlayerController } from "../player/usePlayerController";

export type { PlayerNotice } from "../player/types";

const PlayerContext = createContext<PlayerContextValue | undefined>(undefined);
const PlayerActionsContext = createContext<PlayerActions | undefined>(undefined);
const PlayerNowPlayingContext = createContext<PlayerNowPlaying | undefined>(undefined);
const PlayerQueueStateContext = createContext<PlayerQueueState | undefined>(undefined);
const PlayerSettingsContext = createContext<PlayerSettings | undefined>(undefined);
const PlayerAnalyserContext = createContext<PlayerAnalyser | undefined>(undefined);
const PlayerProgressContext = createContext<PlayerProgress | undefined>(undefined);
const PlayerNoticeContext = createContext<PlayerNoticeState | undefined>(undefined);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const controller = usePlayerController();
  return (
    <PlayerActionsContext.Provider value={controller.actionsValue}>
      <PlayerNowPlayingContext.Provider value={controller.nowPlayingValue}>
        <PlayerQueueStateContext.Provider value={controller.queueStateValue}>
          <PlayerSettingsContext.Provider value={controller.settingsValue}>
            <PlayerAnalyserContext.Provider value={controller.analyserValue}>
              <PlayerProgressContext.Provider value={controller.progressValue}>
                <PlayerNoticeContext.Provider value={controller.noticeValue}>
                  <PlayerContext.Provider value={controller.contextValue}>
                    {children}
                  </PlayerContext.Provider>
                </PlayerNoticeContext.Provider>
              </PlayerProgressContext.Provider>
            </PlayerAnalyserContext.Provider>
          </PlayerSettingsContext.Provider>
        </PlayerQueueStateContext.Provider>
      </PlayerNowPlayingContext.Provider>
    </PlayerActionsContext.Provider>
  );
};

const DEFAULT_ACTIONS: PlayerActions = {
  playSong: async () => {}, playQueue: async () => {}, togglePlay: () => {},
  pausePlayback: () => {}, resumePlayback: async () => {}, seek: () => {},
  setLyricOffsetSeconds: () => {}, adjustLyricOffsetSeconds: () => {},
  playNext: () => {}, playPrev: () => {}, addToQueue: () => {},
  removeFromQueue: () => {}, togglePlayMode: () => {}, clearQueue: () => {},
  setAudioQuality: () => {}, initAudioContext: () => {},
};
const DEFAULT_NOW_PLAYING: PlayerNowPlaying = {
  currentSong: null, isPlaying: false, isLoading: false,
};
const DEFAULT_QUEUE_STATE: PlayerQueueState = { queue: [], playMode: "sequence" };
const DEFAULT_SETTINGS: PlayerSettings = { audioQuality: "320k" };
const DEFAULT_ANALYSER: PlayerAnalyser = { analyser: null };
const DEFAULT_PROGRESS: PlayerProgress = {
  currentTime: 0, duration: 0, lyricOffsetSeconds: 0,
};
const DEFAULT_NOTICE: PlayerNoticeState = { playerNotice: null };
const PLAYER_DEFAULTS: PlayerContextValue = {
  ...DEFAULT_NOW_PLAYING, ...DEFAULT_QUEUE_STATE, ...DEFAULT_SETTINGS,
  ...DEFAULT_ANALYSER, ...DEFAULT_PROGRESS, ...DEFAULT_NOTICE,
  volume: 1, ...DEFAULT_ACTIONS,
};

const useContextValue = <T,>(
  context: React.Context<T | undefined>,
  fallback: T,
  hookName: string,
): T => {
  const value = useContext(context);
  if (!value) {
    console.warn(`[${hookName}] Provider 未就绪，返回默认值（HMR 热更新中）`);
    return fallback;
  }
  return value;
};

export const usePlayer = (): PlayerContextValue =>
  useContextValue(PlayerContext, PLAYER_DEFAULTS, "usePlayer");
export const usePlayerActions = (): PlayerActions =>
  useContextValue(PlayerActionsContext, DEFAULT_ACTIONS, "usePlayerActions");
export const usePlayerNowPlaying = (): PlayerNowPlaying =>
  useContextValue(PlayerNowPlayingContext, DEFAULT_NOW_PLAYING, "usePlayerNowPlaying");
export const usePlayerQueueState = (): PlayerQueueState =>
  useContextValue(PlayerQueueStateContext, DEFAULT_QUEUE_STATE, "usePlayerQueueState");
export const usePlayerSettings = (): PlayerSettings =>
  useContextValue(PlayerSettingsContext, DEFAULT_SETTINGS, "usePlayerSettings");
export const usePlayerAnalyser = (): PlayerAnalyser =>
  useContextValue(PlayerAnalyserContext, DEFAULT_ANALYSER, "usePlayerAnalyser");
export const usePlayerProgress = (): PlayerProgress =>
  useContextValue(PlayerProgressContext, DEFAULT_PROGRESS, "usePlayerProgress");
export const usePlayerNotice = (): PlayerNoticeState =>
  useContextValue(PlayerNoticeContext, DEFAULT_NOTICE, "usePlayerNotice");
