import { useEffect, useState } from "react";
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
import type { AudioHandlers, ParsedSongCacheEntry, PlayerNotice, PlayerRefs } from "./types";

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

  const [refs] = useState<PlayerRefs>(() => {
    const ref = <T,>(current: T) => ({ current });
    return {
      analyser: ref<AnalyserNode | null>(null),
      audio: ref<HTMLAudioElement | null>(null),
      audioContext: ref<AudioContext | null>(null),
      sourceNode: ref<MediaElementAudioSourceNode | null>(null),
      audioContextConnected: ref(false), playRequestId: ref(0),
      parsedSongCache: ref<Map<string, ParsedSongCacheEntry>>(new Map()),
      preloadedResolutionKey: ref<string | null>(null),
      playNext: ref<((force?: boolean) => void) | null>(null),
      playSong: ref<(song: Song, forceQuality?: AudioQuality) => Promise<void>>(async () => {}),
      currentSong: ref(currentSong), queue: ref(queue), playMode: ref(playMode),
      audioQuality: ref(audioQuality), activeQuality: ref<AudioQuality>(audioQuality),
      progressFrame: ref<number | null>(null), lastProgressTime: ref(0),
      play30LoggedKey: ref<string | null>(null), completeLoggedKey: ref<string | null>(null),
      lyricRefreshKey: ref<string | null>(null), retryCount: ref(0),
      forceNoCorsPlayback: ref(false), activeParsedCacheKey: ref<string | null>(null),
      pendingQualityChange: ref(false), refreshedCacheKeys: ref<Set<string>>(new Set()),
      playbackSessionId: ref<string | null>(null),
      failedRecommendationRequestId: ref<string | null>(null),
      failedRecommendationSongKeys: ref<Set<string>>(new Set()),
      handlers: ref<AudioHandlers | null>(null),
      isIOS: ref(/iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)),
    };
  });

  useEffect(() => {
    persistQueue(queue);
    refs.queue.current = queue;
  }, [queue, refs.queue]);
  useEffect(() => {
    persistCurrentSong(currentSong);
    refs.currentSong.current = currentSong;
  }, [currentSong, refs.currentSong]);
  useEffect(() => {
    persistPlayMode(playMode);
    refs.playMode.current = playMode;
  }, [playMode, refs.playMode]);
  useEffect(() => {
    persistAudioQuality(audioQuality);
    refs.audioQuality.current = audioQuality;
  }, [audioQuality, refs.audioQuality]);

  return {
    currentSong, isPlaying, isLoading, currentTime, duration,
    lyricOffsetSeconds, volume: 1, queue, playMode, audioQuality,
    playerNotice, analyser, refs,
    setCurrentSong, setIsPlaying, setIsLoading, setCurrentTime,
    setDuration, setLyricOffsetSeconds, setQueue, setPlayMode,
    setAudioQuality, setPlayerNotice, setAnalyser,
  };
};

export type PlayerRuntime = ReturnType<typeof usePlayerRuntime>;
