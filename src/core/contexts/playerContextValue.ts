import { createContext, useContext, type Context } from 'react';
import type {
  PlayerActions,
  PlayerAnalyser,
  PlayerNoticeState,
  PlayerNowPlaying,
  PlayerProgress,
  PlayerQueueState,
  PlayerSettings,
} from '../player/types';

// 与播放器服务解耦，避免服务热更新重建 Context 后丢失 Provider。
export const PlayerActionsContext = createContext<PlayerActions | undefined>(undefined);
export const PlayerNowPlayingContext = createContext<PlayerNowPlaying | undefined>(undefined);
export const PlayerQueueStateContext = createContext<PlayerQueueState | undefined>(undefined);
export const PlayerSettingsContext = createContext<PlayerSettings | undefined>(undefined);
export const PlayerAnalyserContext = createContext<PlayerAnalyser | undefined>(undefined);
export const PlayerProgressContext = createContext<PlayerProgress | undefined>(undefined);
export const PlayerNoticeContext = createContext<PlayerNoticeState | undefined>(undefined);

const useContextValue = <T>(context: Context<T | undefined>, hookName: string): T => {
  const value = useContext(context);
  if (!value) throw new Error(`${hookName} 必须在 PlayerProvider 内使用`);
  return value;
};

export const usePlayerActions = (): PlayerActions =>
  useContextValue(PlayerActionsContext, 'usePlayerActions');
export const usePlayerNowPlaying = (): PlayerNowPlaying =>
  useContextValue(PlayerNowPlayingContext, 'usePlayerNowPlaying');
export const usePlayerQueueState = (): PlayerQueueState =>
  useContextValue(PlayerQueueStateContext, 'usePlayerQueueState');
export const usePlayerSettings = (): PlayerSettings =>
  useContextValue(PlayerSettingsContext, 'usePlayerSettings');
export const usePlayerAnalyser = (): PlayerAnalyser =>
  useContextValue(PlayerAnalyserContext, 'usePlayerAnalyser');
export const usePlayerProgress = (): PlayerProgress =>
  useContextValue(PlayerProgressContext, 'usePlayerProgress');
export const usePlayerNotice = (): PlayerNoticeState =>
  useContextValue(PlayerNoticeContext, 'usePlayerNotice');
