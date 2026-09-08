import React from "react";
import {
  PlayerActionsContext,
  PlayerAnalyserContext,
  PlayerNoticeContext,
  PlayerNowPlayingContext,
  PlayerProgressContext,
  PlayerQueueStateContext,
  PlayerSettingsContext,
} from './playerContextValue';
import { usePlayerController } from "../player/usePlayerController";

export type { PlayerNotice } from "../player/types";
export {
  usePlayerActions,
  usePlayerNowPlaying,
  usePlayerQueueState,
  usePlayerSettings,
  usePlayerAnalyser,
  usePlayerProgress,
  usePlayerNotice,
} from './playerContextValue';

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
                  {children}
                </PlayerNoticeContext.Provider>
              </PlayerProgressContext.Provider>
            </PlayerAnalyserContext.Provider>
          </PlayerSettingsContext.Provider>
        </PlayerQueueStateContext.Provider>
      </PlayerNowPlayingContext.Provider>
    </PlayerActionsContext.Provider>
  );
};
