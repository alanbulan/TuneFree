import { useCallback, useEffect, useState } from "react";
import type { AudioQuality, PlayMode, Song } from "../types";
import {
  loadStoredAudioQuality,
  loadStoredCurrentSong,
  loadStoredPlayMode,
  loadStoredQueue,
  persistAudioQuality,
  persistCurrentSong,
  persistPlayMode,
  persistQueue,
} from "../contexts/playerPersistence";
import type { ShuffleOrder } from "../contexts/playerQueue";
import type { AudioHandlers, ParsedSongCacheEntry, PlayerNotice, PlayerRefs } from "./types";
import type { RecoveryStage } from "./playbackRecovery";

const createPlayerRefs = (
  currentSong: Song | null,
  queue: Song[],
  playMode: PlayMode,
  audioQuality: AudioQuality,
): PlayerRefs => {
  const ref = <T,>(current: T) => ({ current });
  return {
    analyser: ref<AnalyserNode | null>(null),
    audio: ref<HTMLAudioElement | null>(null),
    audioContext: ref<AudioContext | null>(null),
    sourceNode: ref<MediaElementAudioSourceNode | null>(null),
    audioContextConnected: ref(false), playRequestId: ref(0),
    playAbort: ref<AbortController | null>(null),
    preloadAbort: ref<AbortController | null>(null),
    parsedSongCache: ref<Map<string, ParsedSongCacheEntry>>(new Map()),
    preloadedResolutionKey: ref<string | null>(null),
    playNext: ref<((force?: boolean) => void) | null>(null),
    playSong: ref<(song: Song, forceQuality?: AudioQuality) => Promise<void>>(async () => {}),
    currentSong: ref(currentSong), queue: ref(queue),
    shuffleOrder: ref<ShuffleOrder | null>(null), playMode: ref(playMode),
    audioQuality: ref(audioQuality), activeQuality: ref<AudioQuality>(audioQuality),
    progressFrame: ref<number | null>(null), lastProgressTime: ref(0),
    play30LoggedKey: ref<string | null>(null), completeLoggedKey: ref<string | null>(null),
    lyricRefreshKey: ref<string | null>(null), lyricBindings: ref(new Map()),
    lyricMismatchNoticedKey: ref<string | null>(null),
    recoveryStage: ref<RecoveryStage>("initial"),
    forceNoCorsPlayback: ref(false), activeParsedCacheKey: ref<string | null>(null),
    pendingQualityChange: ref(false), refreshedCacheKeys: ref<Set<string>>(new Set()),
    playbackSessionId: ref<string | null>(null),
    failedRecommendationRequestId: ref<string | null>(null),
    failedRecommendationSongKeys: ref<Set<string>>(new Set()),
    handlers: ref<AudioHandlers | null>(null),
    isIOS: ref(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
  };
};

export const usePlayerRuntime = () => {
  const [currentSong, setCurrentSong] = useState<Song | null>(loadStoredCurrentSong);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [lyricOffsetSeconds, setLyricOffsetSeconds] = useState(0);
  const [queue, setQueue] = useState<Song[]>(loadStoredQueue);
  const [playMode, setPlayMode] = useState<PlayMode>(loadStoredPlayMode);
  const [audioQuality, setAudioQuality] = useState<AudioQuality>(loadStoredAudioQuality);
  const [playerNotice, setPlayerNotice] = useState<PlayerNotice | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const [refs] = useState<PlayerRefs>(
    () => createPlayerRefs(currentSong, queue, playMode, audioQuality),
  );
  const {
    queue: queueRef, currentSong: currentSongRef, playMode: playModeRef,
    audioQuality: audioQualityRef,
  } = refs;

  // 队列与当前歌曲的唯一写入口：ref 先于 state 落地，
  // 因此 updater 内部不再需要（也不允许）写 ref。
  const commitQueue = useCallback((next: Song[] | ((previous: Song[]) => Song[])) => {
    const nextQueue = typeof next === "function" ? next(queueRef.current) : next;
    if (nextQueue === queueRef.current) return;
    queueRef.current = nextQueue;
    setQueue(nextQueue);
  }, [queueRef]);

  const commitCurrentSong = useCallback((next: Song | null) => {
    if (next === currentSongRef.current) return;
    currentSongRef.current = next;
    setCurrentSong(next);
  }, [currentSongRef]);

  useEffect(() => { persistQueue(queue); }, [queue]);
  useEffect(() => { persistCurrentSong(currentSong); }, [currentSong]);
  useEffect(() => {
    persistPlayMode(playMode);
    playModeRef.current = playMode;
  }, [playMode, playModeRef]);
  useEffect(() => {
    persistAudioQuality(audioQuality);
    audioQualityRef.current = audioQuality;
  }, [audioQuality, audioQualityRef]);

  return {
    currentSong, isPlaying, isLoading, currentTime, duration,
    lyricOffsetSeconds, queue, playMode, audioQuality,
    playerNotice, analyser, refs,
    commitQueue, commitCurrentSong,
    setIsPlaying, setIsLoading, setCurrentTime,
    setDuration, setLyricOffsetSeconds, setPlayMode,
    setAudioQuality, setPlayerNotice, setAnalyser,
  };
};

export type PlayerRuntime = ReturnType<typeof usePlayerRuntime>;
