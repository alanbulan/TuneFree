import type { MutableRefObject } from "react";
import type { ShuffleOrder } from "../contexts/playerQueue";
import type { AudioQuality, PlayMode, Song } from "../types";
import type { parseSongFull } from "../services/api";
import type { RecoveryStage } from "./playbackRecovery";

/**
 * 播放失败类提示的语义，界面据此附带操作：
 * `playbackFailed` 已停止播放（可切下一首、去音源页），`songSkipped` 已自动跳过（可去音源页）。
 */
export type PlayerNoticeKind = "playbackFailed" | "songSkipped";

export interface PlayerNotice {
  id: number;
  tone: "info" | "success" | "warning" | "error";
  message: string;
  kind?: PlayerNoticeKind;
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
  /** 本次运行中播放失败、尚未成功播放过的歌曲键（`getSongKey`），供队列标记。 */
  unplayableSongKeys: ReadonlySet<string>;
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
export type PlayerNoticeState = Pick<PlayerContextValue, "playerNotice" | "unplayableSongKeys">;

export type ParsedSongData = NonNullable<Awaited<ReturnType<typeof parseSongFull>>>;
export interface ParsedSongCacheEntry { data: ParsedSongData; expiresAt: number }
export interface ParsedSongResolution { parsed: ParsedSongData | null; cacheKey: string | null }
export interface ResolvedLyricBinding {
  source: string;
  id?: string | number;
  lyricId?: string | number;
  picId?: string;
  songMeta?: ParsedSongData['resolvedSongMeta'];
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
  /** 本轮「歌曲 + 音质」每次刷新解析前播放失败的地址（未知时为空串）；刷新次数有上限，重新解析时跳过这些地址。 */
  refreshedResolutions: MutableRefObject<Map<string, string[]>>;
  playbackSessionId: MutableRefObject<string | null>;
  failedRecommendationRequestId: MutableRefObject<string | null>;
  failedRecommendationSongKeys: MutableRefObject<Set<string>>;
  /** 普通队列里连续播放失败、已被自动跳过的歌曲；正常播放一段时间或最终放弃时清空。 */
  failedQueueSongKeys: MutableRefObject<Set<string>>;
  handlers: MutableRefObject<AudioHandlers | null>;
  isIOS: MutableRefObject<boolean>;
}
