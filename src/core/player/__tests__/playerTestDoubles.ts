import { vi } from "vitest";
import type { AudioQuality, Song } from "../../types";
import type { PlayerRefs } from "../types";
import type { PlayerRuntime } from "../usePlayerRuntime";

/** Minimal stand-in for the media element the player drives. */
export interface FakeAudioElement {
  src: string;
  paused: boolean;
  currentTime: number;
  duration: number;
  crossOrigin: string | null;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  removeAttribute: ReturnType<typeof vi.fn>;
}

export const createFakeAudio = (): FakeAudioElement => {
  const element: FakeAudioElement = {
    src: "",
    paused: true,
    currentTime: 0,
    duration: 180,
    crossOrigin: null,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
  };
  element.pause.mockImplementation(() => {
    element.paused = true;
  });
  element.removeAttribute.mockImplementation(() => {
    element.src = "";
  });
  return element;
};

export const song = (id: string, patch: Partial<Song> = {}): Song => ({
  id,
  source: "netease",
  name: `歌曲 ${id}`,
  artist: "歌手",
  album: "专辑",
  ...patch,
});

export interface RuntimeDouble {
  runtime: PlayerRuntime;
  refs: PlayerRefs;
  audio: FakeAudioElement;
  /** 每次 commitQueue 真正写入新引用时递增，用来断言"没有多余的队列写入"。 */
  queueWrites: () => number;
  setIsPlaying: ReturnType<typeof vi.fn>;
  setIsLoading: ReturnType<typeof vi.fn>;
  setDuration: ReturnType<typeof vi.fn>;
  commitQueue: ReturnType<typeof vi.fn>;
  commitCurrentSong: ReturnType<typeof vi.fn>;
}

const ref = <T,>(current: T) => ({ current });

/**
 * Build a `PlayerRuntime` double whose refs behave like the real ones: `commitQueue` /
 * `commitCurrentSong` write the ref before the (stubbed) state, so callers reading
 * `refs.queue.current` right after a commit see the new value.
 */
export const createRuntimeDouble = (options: {
  queue?: Song[];
  currentSong?: Song | null;
  audioQuality?: AudioQuality;
  audio?: FakeAudioElement | null;
} = {}): RuntimeDouble => {
  const quality = options.audioQuality ?? "320k";
  const audio = options.audio === undefined ? createFakeAudio() : options.audio;
  let writes = 0;

  const refs = {
    analyser: ref(null),
    audio: ref(audio as unknown as HTMLAudioElement | null),
    audioContext: ref(null),
    sourceNode: ref(null),
    audioContextConnected: ref(false),
    playRequestId: ref(0),
    playAbort: ref<AbortController | null>(null),
    preloadAbort: ref<AbortController | null>(null),
    parsedSongCache: ref(new Map()),
    preloadedResolutionKey: ref<string | null>(null),
    playNext: ref<((force?: boolean) => void) | null>(null),
    playSong: ref(vi.fn(() => Promise.resolve())),
    currentSong: ref(options.currentSong ?? null),
    queue: ref(options.queue ?? []),
    shuffleOrder: ref(null),
    playMode: ref("sequence"),
    audioQuality: ref(quality),
    activeQuality: ref(quality),
    progressFrame: ref<number | null>(null),
    lastProgressTime: ref(0),
    play30LoggedKey: ref<string | null>(null),
    completeLoggedKey: ref<string | null>(null),
    lyricRefreshKey: ref<string | null>(null),
    lyricBindings: ref(new Map()),
    lyricMismatchNoticedKey: ref<string | null>(null),
    recoveryStage: ref("initial"),
    forceNoCorsPlayback: ref(false),
    activeParsedCacheKey: ref<string | null>(null),
    pendingQualityChange: ref(false),
    refreshedCacheKeys: ref(new Set<string>()),
    playbackSessionId: ref<string | null>(null),
    failedRecommendationRequestId: ref<string | null>(null),
    failedRecommendationSongKeys: ref(new Set<string>()),
    handlers: ref(null),
    isIOS: ref(false),
  } as unknown as PlayerRefs;

  const commitQueue = vi.fn((next: Song[] | ((previous: Song[]) => Song[])) => {
    const value = typeof next === "function" ? next(refs.queue.current) : next;
    if (value === refs.queue.current) return;
    writes += 1;
    refs.queue.current = value;
  });
  const commitCurrentSong = vi.fn((next: Song | null) => {
    if (next === refs.currentSong.current) return;
    refs.currentSong.current = next;
  });
  const setIsPlaying = vi.fn();
  const setIsLoading = vi.fn();
  const setDuration = vi.fn();

  const runtime = {
    refs,
    commitQueue,
    commitCurrentSong,
    setIsPlaying,
    setIsLoading,
    setDuration,
    setCurrentTime: vi.fn(),
    setLyricOffsetSeconds: vi.fn(),
    setPlayMode: vi.fn(),
    setAudioQuality: vi.fn(),
    setPlayerNotice: vi.fn(),
    setAnalyser: vi.fn(),
    currentSong: refs.currentSong.current,
    queue: refs.queue.current,
    isPlaying: false,
    isLoading: false,
    currentTime: 0,
    duration: 0,
    lyricOffsetSeconds: 0,
    playMode: "sequence",
    audioQuality: quality,
    playerNotice: null,
    analyser: null,
  } as unknown as PlayerRuntime;

  return {
    runtime,
    refs,
    audio: audio as FakeAudioElement,
    queueWrites: () => writes,
    setIsPlaying,
    setIsLoading,
    setDuration,
    commitQueue,
    commitCurrentSong,
  };
};

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export const deferred = <T,>(): Deferred<T> => {
  let settle!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
};

export const abortError = (): Error => {
  const error = new Error("已取消");
  error.name = "AbortError";
  return error;
};
