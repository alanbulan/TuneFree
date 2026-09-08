import type { MutableRefObject } from "react";
import type { ShuffleOrder } from "../contexts/playerQueue";
import type { AudioQuality, PlayMode, Song } from "../types";
import type { parseSongFull } from "../services/api";
import type { RecoveryStage } from "./playbackRecovery";

export interface PlayerNotice {
  id: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
}

export interface PlayerContextValue {
  currentSong: Song | null;
  isPlaying: boolean;
  isLoading: boolean;
  /** 播放进度是否已进入尾声（> 0.92），低频派生量，供桌宠等只关心阈值的订阅方使用。 */
  isNearEnd: boolean;
  currentTime: number;
  duration: number;
  lyricOffsetSeconds: number;
  playMode: PlayMode;
  queue: Song[];
  analyser: AnalyserNode | null;
  audioQuality: AudioQuality;
  playerNotice: PlayerNotice | null;
  playSong: (song: Song, forceQuality?: AudioQuality) => Promise<void>;
  playQueue: (songs: Song[], startSong?: Song) => Promise<void>;
  togglePlay: () => void;
  pausePlayback: () => void;
  resumePlayback: () => Promise<void>;
  seek: (time: number) => void;
  setLyricOffsetSeconds: (offset: number) => void;
  adjustLyricOffsetSeconds: (delta: number) => void;
  playNext: (force?: boolean) => void;
  playPrev: () => void;
  addToQueue: (song: Song) => void;
  removeFromQueue: (songId: string | number, source?: string) => void;
  togglePlayMode: () => void;
  clearQueue: () => void;
  setAudioQuality: (quality: AudioQuality) => void;
  initAudioContext: () => void;
}

export type PlayerActions = Pick<PlayerContextValue,
  | "playSong" | "playQueue" | "togglePlay" | "pausePlayback"
  | "resumePlayback" | "seek" | "setLyricOffsetSeconds"
  | "adjustLyricOffsetSeconds" | "playNext" | "playPrev"
  | "addToQueue" | "removeFromQueue" | "togglePlayMode"
  | "clearQueue" | "setAudioQuality" | "initAudioContext"
>;
export type PlayerNowPlaying =
  Pick<PlayerContextValue, "currentSong" | "isPlaying" | "isLoading" | "isNearEnd">;
export type PlayerQueueState = Pick<PlayerContextValue, "queue" | "playMode">;
export type PlayerSettings = Pick<PlayerContextValue, "audioQuality">;
export type PlayerAnalyser = Pick<PlayerContextValue, "analyser">;
export type PlayerProgress = Pick<PlayerContextValue, "currentTime" | "duration" | "lyricOffsetSeconds">;
export type PlayerNoticeState = Pick<PlayerContextValue, "playerNotice">;

export type ParsedSongData = NonNullable<Awaited<ReturnType<typeof parseSongFull>>>;
export interface ParsedSongCacheEntry { data: ParsedSongData; expiresAt: number }
export interface ParsedSongResolution { parsed: ParsedSongData | null; cacheKey: string | null }
export interface ResolvedLyricBinding {
  source: string;
  id?: string | number;
  lyricId?: string | number;
  picId?: string;
}

export interface AudioHandlers {
  timeupdate: () => void;
  loadedmetadata: () => void;
  durationchange: () => void;
  ended: () => void;
  error: (event: Event) => void;
  waiting: () => void;
  canplay: () => void;
}

export interface PlayerRefs {
  analyser: MutableRefObject<AnalyserNode | null>;
  audio: MutableRefObject<HTMLAudioElement | null>;
  audioContext: MutableRefObject<AudioContext | null>;
  sourceNode: MutableRefObject<MediaElementAudioSourceNode | null>;
  audioContextConnected: MutableRefObject<boolean>;
  playRequestId: MutableRefObject<number>;
  /** 当前播放请求的解析链路取消句柄；新请求开始时 abort 上一个。 */
  playAbort: MutableRefObject<AbortController | null>;
  /** 预加载解析链路的取消句柄，与播放请求彼此独立。 */
  preloadAbort: MutableRefObject<AbortController | null>;
  parsedSongCache: MutableRefObject<Map<string, ParsedSongCacheEntry>>;
  preloadedResolutionKey: MutableRefObject<string | null>;
  playNext: MutableRefObject<((force?: boolean) => void) | null>;
  playSong: MutableRefObject<(song: Song, forceQuality?: AudioQuality) => Promise<void>>;
  currentSong: MutableRefObject<Song | null>;
  queue: MutableRefObject<Song[]>;
  /** 随机播放的一次性顺序表，队列成员变化时才重新洗牌。 */
  shuffleOrder: MutableRefObject<ShuffleOrder | null>;
  playMode: MutableRefObject<PlayMode>;
  audioQuality: MutableRefObject<AudioQuality>;
  activeQuality: MutableRefObject<AudioQuality>;
  progressFrame: MutableRefObject<number | null>;
  lastProgressTime: MutableRefObject<number>;
  play30LoggedKey: MutableRefObject<string | null>;
  completeLoggedKey: MutableRefObject<string | null>;
  lyricRefreshKey: MutableRefObject<string | null>;
  lyricBindings: MutableRefObject<Map<string, ResolvedLyricBinding>>;
  lyricMismatchNoticedKey: MutableRefObject<string | null>;
  /** 当前歌曲已经走到的失败恢复阶段，播放成功或换歌时复位。 */
  recoveryStage: MutableRefObject<RecoveryStage>;
  forceNoCorsPlayback: MutableRefObject<boolean>;
  activeParsedCacheKey: MutableRefObject<string | null>;
  pendingQualityChange: MutableRefObject<boolean>;
  refreshedCacheKeys: MutableRefObject<Set<string>>;
  playbackSessionId: MutableRefObject<string | null>;
  failedRecommendationRequestId: MutableRefObject<string | null>;
  failedRecommendationSongKeys: MutableRefObject<Set<string>>;
  handlers: MutableRefObject<AudioHandlers | null>;
  isIOS: MutableRefObject<boolean>;
}
