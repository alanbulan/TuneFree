import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/music_source.dart';
import '../../../core/models/song.dart';
import '../../search/application/search_providers.dart';
import '../data/player_download_service.dart';
import '../data/local_playback_resolver.dart';
import '../data/player_preferences_store.dart';
import '../data/song_resolution_repository.dart';
import '../domain/player_state.dart';
import '../domain/player_track.dart';
import 'just_audio_player_engine.dart';
import 'media_session_adapter.dart';
import 'playback_lifecycle_coordinator.dart';
import 'player_engine.dart';
import 'player_queue_manager.dart';

final playerEngineProvider = Provider<PlayerEngine>((ref) {
  final mediaSessionAdapter = ref.watch(mediaSessionAdapterProvider);
  final engine = JustAudioPlayerEngine.real(
    mediaSessionAdapter: mediaSessionAdapter,
  );
  ref.onDispose(engine.dispose);
  return engine;
});

final mediaSessionAdapterProvider = Provider<MediaSessionAdapter>((ref) {
  return AudioServiceMediaSessionAdapter();
});

const List<String> _playbackFallbackSources = <String>[
  'netease',
  'qq',
  'kuwo',
  'joox',
  'bilibili',
];

const Set<String> _gdStudioResolvableSources = <String>{
  'netease',
  'qq',
  'kuwo',
  'joox',
  'bilibili',
};

const Map<String, String> _playbackSourceLabels = <String, String>{
  'netease': '网易云',
  'qq': 'QQ音乐',
  'kuwo': '酷我音乐',
  'joox': 'JOOX',
  'bilibili': 'Bilibili',
};

const _fallbackSearchLimit = 6;
const _fallbackCandidateLimit = 3;

final localPlaybackResolverProvider = Provider<LocalPlaybackResolver>((ref) {
  final recordStore = ref.watch(downloadRecordStoreProvider);
  final fileStore = ref.watch(downloadFileStoreProvider);
  return LocalPlaybackResolver(
    recordsForSong: (songKey) => recordStore.listBySongKey(songKey),
    fileExists: fileStore.fileExists,
    removeRecord: ({required songKey, required quality}) =>
        recordStore.remove(songKey: songKey, quality: quality),
  );
});

final playerControllerProvider =
    NotifierProvider<PlayerControllerNotifier, PlayerState>(
      PlayerControllerNotifier.new,
    );

final class PlayerController extends ChangeNotifier
    with _PlayerControllerRuntimeApi {
  PlayerController.runtime({
    required PlayerEngine engine,
    required PlayerPreferencesStore preferencesStore,
    SongResolutionRepository? songResolutionRepository,
    MediaSessionAdapter? mediaSessionAdapter,
    PlaybackLifecycleEventSource? lifecycleEventSource,
    LocalPlaybackResolver? localPlaybackResolver,
    PlayerFallbackSongSearch? fallbackSongSearch,
  }) {
    initializeRuntime(
      engine: engine,
      preferencesStore: preferencesStore,
      mediaSessionAdapter: mediaSessionAdapter ?? NoopMediaSessionAdapter(),
      lifecycleEventSource:
          lifecycleEventSource ?? const NoopPlaybackLifecycleEventSource(),
      resolveSongOverride: songResolutionRepository == null
          ? null
          : (song, quality) => songResolutionRepository.resolveSong(
              song,
              quality: quality.wireValue,
            ),
      localPlaybackResolver: localPlaybackResolver,
      fallbackSongSearch: fallbackSongSearch,
    );
  }

  PlayerState _state = const PlayerState();

  @override
  PlayerState get state => _state;

  @override
  set state(PlayerState value) {
    if (_state == value) {
      return;
    }
    _state = value;
    notifyListeners();
  }
}

final class PlayerControllerNotifier extends Notifier<PlayerState>
    with _PlayerControllerRuntimeApi {
  bool _initialized = false;

  @override
  PlayerState build() {
    if (!_initialized) {
      _initialized = true;
      initializeRuntime(
        engine: ref.read(playerEngineProvider),
        preferencesStore: ref.read(playerPreferencesStoreProvider),
        mediaSessionAdapter: ref.read(mediaSessionAdapterProvider),
        lifecycleEventSource: AudioSessionPlaybackLifecycleEventSource(),
        resolveSongOverride: (song, quality) => ref
            .read(songResolutionRepositoryProvider)
            .resolveSong(song, quality: quality.wireValue),
        localPlaybackResolver: ref.read(localPlaybackResolverProvider),
        fallbackSongSearch: (keyword, source) => ref
            .read(remoteSearchRepositoryProvider)
            .searchSingle(keyword, source: source, page: 1),
      );
      ref.onDispose(() {
        unawaited(disposeController(disposeEngine: false));
      });
    }

    return const PlayerState();
  }
}

typedef PlayerSongResolver =
    Future<Song> Function(Song song, AudioQuality quality);
typedef PlayerFallbackSongSearch =
    Future<List<Song>> Function(String keyword, String source);

mixin _PlayerControllerRuntimeApi {
  late final PlayerEngine _engine;
  late final PlayerPreferencesStore _preferencesStore;
  PlaybackLifecycleCoordinator? _playbackLifecycleCoordinator;
  PlayerSongResolver? _resolveSongOverride;
  PlayerFallbackSongSearch? _fallbackSongSearch;
  LocalPlaybackResolver? _localPlaybackResolver;
  StreamSubscription<PlayerEngineSnapshot>? _subscription;
  int _playbackMutationRevision = 0;
  int _playModeMutationRevision = 0;
  int _audioQualityMutationRevision = 0;
  int _downloadQualityMutationRevision = 0;
  PlayerEngineProcessingState _lastProcessingState =
      PlayerEngineProcessingState.idle;
  bool _handlingCompletion = false;
  int _playbackNoticeRevision = 0;
  String? _lastStoppedSongKey;
  String? _ignoredSnapshotSongKey;
  String? _lastPreloadCacheKey;

  PlayerState get state;
  set state(PlayerState value);

  @protected
  void initializeRuntime({
    required PlayerEngine engine,
    required PlayerPreferencesStore preferencesStore,
    required MediaSessionAdapter mediaSessionAdapter,
    required PlaybackLifecycleEventSource lifecycleEventSource,
    PlayerSongResolver? resolveSongOverride,
    LocalPlaybackResolver? localPlaybackResolver,
    PlayerFallbackSongSearch? fallbackSongSearch,
  }) {
    _engine = engine;
    _preferencesStore = preferencesStore;
    _resolveSongOverride = resolveSongOverride;
    _fallbackSongSearch = fallbackSongSearch;
    _localPlaybackResolver = localPlaybackResolver;
    _subscription = _engine.snapshots.listen(_applySnapshot);
    _playbackLifecycleCoordinator = PlaybackLifecycleCoordinator(
      remoteCommands: mediaSessionAdapter.remoteCommands,
      eventSource: lifecycleEventSource,
      isPlaying: () => state.isPlaying,
      onPlay: play,
      onPause: pause,
      onStop: stop,
      onSkipNext: playNext,
      onSkipPrevious: playPrev,
      onSeek: seek,
    );
    unawaited(_hydrateFromPreferences());
  }

  Future<void> playSong(
    Song song, {
    List<Song>? queue,
    AudioQuality? forceQuality,
  }) {
    return _openSong(
      song,
      queue: queue,
      forceQuality: forceQuality,
      autoPlay: true,
    );
  }

  Future<void> openTrack(PlayerTrack track, {List<PlayerTrack>? queue}) {
    return _openSong(
      _songFromTrack(track),
      queue: (queue ?? <PlayerTrack>[track])
          .map(_songFromTrack)
          .toList(growable: false),
      autoPlay: false,
    );
  }

  Future<void> openLegacySong({
    required String id,
    required String source,
    required String title,
    required String artist,
    String? artworkUrl,
    String? streamUrl,
    String? lyrics,
    List<PlayerTrack>? queue,
  }) {
    final track = PlayerTrack(
      id: id,
      source: source,
      title: title,
      artist: artist,
      artworkUrl: artworkUrl,
      streamUrl: streamUrl,
      lyrics: lyrics,
    );
    return openTrack(track, queue: queue ?? <PlayerTrack>[track]);
  }

  Future<void> play() async {
    final currentSong = state.currentSong;
    if (currentSong != null) {
      await _engine.play();
      return;
    }

    final recoveredSong = _recoverSongFromQueue();
    if (recoveredSong == null) {
      return;
    }

    await playSong(
      recoveredSong,
      queue: state.queue,
      forceQuality: state.audioQuality,
    );
  }

  Future<void> pause() async {
    if (state.currentSong == null) {
      return;
    }

    await _engine.pause();
  }

  Future<void> stop() async {
    final previousSong = state.currentSong;
    final previousQueue = state.queue;
    final previousIsPlaying = state.isPlaying;
    final previousIsLoading = state.isLoading;
    final previousPosition = state.position;
    final previousDuration = state.duration;
    final previousLastStoppedSongKey = _lastStoppedSongKey;
    final previousIgnoredSnapshotSongKey = _ignoredSnapshotSongKey;
    final previousPlaybackMutationRevision = _playbackMutationRevision;

    _playbackMutationRevision = previousPlaybackMutationRevision + 1;
    _ignoredSnapshotSongKey = null;
    _lastStoppedSongKey = state.currentSong?.key ?? _lastStoppedSongKey;

    try {
      await _engine.stop();
    } catch (error) {
      state = state.copyWith(
        currentSong: previousSong,
        isPlaying: previousIsPlaying,
        isLoading: previousIsLoading,
        position: previousPosition,
        duration: previousDuration,
        queue: previousQueue,
      );
      _playbackMutationRevision = previousPlaybackMutationRevision;
      _lastStoppedSongKey = previousLastStoppedSongKey;
      _ignoredSnapshotSongKey = previousIgnoredSnapshotSongKey;

      await _preferencesStore.saveCurrentSong(previousSong);
      await _preferencesStore.saveQueue(previousQueue);
      rethrow;
    }

    state = state.copyWith(
      currentSong: null,
      isPlaying: false,
      isLoading: false,
      position: Duration.zero,
      duration: Duration.zero,
      playbackNotice: null,
    );
    await _preferencesStore.saveCurrentSong(null);
    await _preferencesStore.saveQueue(state.queue);
    await _engine.clearMediaSession();
  }

  Future<void> togglePlay() async {
    if (state.isPlaying) {
      await pause();
      return;
    }

    await play();
  }

  Future<void> togglePlayback() => togglePlay();

  Future<void> seek(Duration position) {
    return _engine.seek(_clampSeekPosition(position));
  }

  Future<void> playNext({bool force = true}) async {
    final queue = state.queue;
    if (queue.isEmpty) {
      return;
    }

    if (!force && state.playMode == loopPlayMode) {
      await seek(Duration.zero);
      await _engine.play();
      return;
    }

    final nextIndex = getNextQueueIndex(
      queue,
      state.currentSong,
      state.playMode,
    );
    if (nextIndex < 0) {
      return;
    }

    await playSong(
      queue[nextIndex],
      queue: queue,
      forceQuality: state.audioQuality,
    );
  }

  Future<void> playPrev() async {
    final queue = state.queue;
    if (queue.isEmpty) {
      return;
    }

    if (state.position > const Duration(seconds: 3)) {
      await seek(Duration.zero);
      return;
    }

    final previousIndex = getPreviousQueueIndex(
      queue,
      state.currentSong,
      state.playMode,
    );
    if (previousIndex < 0) {
      return;
    }

    await playSong(
      queue[previousIndex],
      queue: queue,
      forceQuality: state.audioQuality,
    );
  }

  Future<void> playPrevious() => playPrev();

  void togglePlayMode() {
    final nextPlayMode = switch (state.playMode) {
      sequencePlayMode => loopPlayMode,
      loopPlayMode => shufflePlayMode,
      _ => sequencePlayMode,
    };

    _playModeMutationRevision += 1;
    state = state.copyWith(playMode: nextPlayMode);
    unawaited(_preferencesStore.savePlayMode(nextPlayMode));
  }

  void cyclePlayMode() => togglePlayMode();

  Future<void> setAudioQuality(AudioQuality quality) async {
    _audioQualityMutationRevision += 1;
    state = state.copyWith(audioQuality: quality);
    await _preferencesStore.saveAudioQuality(quality);
    await _engine.setAudioQuality(quality);
  }

  Future<void> setPlaybackQuality(AudioQuality quality) =>
      setAudioQuality(quality);

  void setDownloadQuality(AudioQuality quality) {
    _downloadQualityMutationRevision += 1;
    state = state.copyWith(downloadQuality: quality);
  }

  void expand() {
    state = state.copyWith(isExpanded: true);
  }

  void collapse() {
    state = state.copyWith(
      isExpanded: false,
      showLyrics: false,
      showQueue: false,
      showDownload: false,
      showMore: false,
    );
  }

  void setShowLyrics(bool value) {
    state = state.copyWith(showLyrics: value);
  }

  void setShowQueue(bool value) {
    state = state.copyWith(showQueue: value);
  }

  void setShowDownload(bool value) {
    state = state.copyWith(showDownload: value);
  }

  void setShowMore(bool value) {
    state = state.copyWith(showMore: value);
  }

  Future<void> clearQueue() async {
    _playbackMutationRevision += 1;
    _ignoredSnapshotSongKey =
        state.currentSong?.key ?? _engine.latestSnapshot.currentSong?.key;
    await _engine.pause();
    await _engine.clearMediaSession();
    state = state.copyWith(
      currentSong: null,
      queue: const <Song>[],
      isPlaying: false,
      isLoading: false,
      position: Duration.zero,
      duration: Duration.zero,
      showQueue: true,
      showDownload: false,
      showMore: false,
      playbackNotice: null,
    );
    await _preferencesStore.saveCurrentSong(null);
    await _preferencesStore.saveQueue(const <Song>[]);
  }

  Future<void> disposeController({bool disposeEngine = true}) async {
    await _subscription?.cancel();
    await _playbackLifecycleCoordinator?.dispose();
    if (disposeEngine) {
      await _engine.dispose();
    }
  }

  Future<void> _hydrateFromPreferences() async {
    final playbackRevision = _playbackMutationRevision;
    final playModeRevision = _playModeMutationRevision;
    final audioQualityRevision = _audioQualityMutationRevision;
    final downloadQualityRevision = _downloadQualityMutationRevision;
    final currentSong = await _preferencesStore.loadCurrentSong();
    final queue = await _preferencesStore.loadQueue();
    final playMode = normalizePlayMode(await _preferencesStore.loadPlayMode());
    final audioQuality = await _preferencesStore.loadAudioQuality();
    final hydratedQueue = List<Song>.unmodifiable(
      queue.isEmpty && currentSong != null ? <Song>[currentSong] : queue,
    );
    final shouldHydratePlaybackState =
        playbackRevision == _playbackMutationRevision &&
        state.currentSong == null &&
        state.queue.isEmpty &&
        !state.isLoading &&
        !state.isPlaying &&
        state.position == Duration.zero &&
        state.duration == Duration.zero;
    final shouldHydratePlayMode = playModeRevision == _playModeMutationRevision;
    final shouldHydrateAudioQuality =
        audioQualityRevision == _audioQualityMutationRevision;
    final shouldHydrateDownloadQuality =
        downloadQualityRevision == _downloadQualityMutationRevision;

    state = state.copyWith(
      currentSong: shouldHydratePlaybackState ? currentSong : state.currentSong,
      queue: shouldHydratePlaybackState ? hydratedQueue : state.queue,
      playMode: shouldHydratePlayMode ? playMode : state.playMode,
      audioQuality: shouldHydrateAudioQuality
          ? audioQuality
          : state.audioQuality,
      downloadQuality: shouldHydrateDownloadQuality
          ? audioQuality
          : state.downloadQuality,
    );
  }

  Future<void> _openSong(
    Song song, {
    List<Song>? queue,
    AudioQuality? forceQuality,
    required bool autoPlay,
  }) async {
    final playbackRevision = _playbackMutationRevision + 1;
    _playbackMutationRevision = playbackRevision;
    _ignoredSnapshotSongKey = null;
    final quality = forceQuality ?? state.audioQuality;
    final nextQueue = List<Song>.unmodifiable(
      _resolveQueue(song: song, queue: queue),
    );
    List<Song>? fallbackCandidates;

    bool isCurrentRequest() => playbackRevision == _playbackMutationRevision;

    Future<bool> commitPlayableSong(
      Song playableSong,
      List<Song> playableQueue,
      AudioQuality playableQuality,
    ) async {
      if (!isCurrentRequest()) {
        return false;
      }
      state = state.copyWith(
        currentSong: playableSong,
        queue: playableQueue,
        audioQuality: playableQuality,
        playbackNotice: null,
      );

      await _preferencesStore.saveCurrentSong(playableSong);
      if (!isCurrentRequest()) {
        return false;
      }
      await _preferencesStore.saveQueue(playableQueue);
      if (!isCurrentRequest()) {
        return false;
      }
      await _preferencesStore.saveAudioQuality(playableQuality);
      if (!isCurrentRequest()) {
        return false;
      }
      await _engine.loadSong(playableSong, quality: playableQuality);
      if (!isCurrentRequest()) {
        return false;
      }
      if (autoPlay) {
        await _engine.play();
      }
      if (!isCurrentRequest()) {
        return false;
      }
      _preloadNextSong(playableSong, playableQueue, playableQuality);
      return true;
    }

    Future<bool> tryPlayableSong(
      Song candidate,
      AudioQuality candidateQuality, {
      required Song queueAnchor,
    }) async {
      try {
        final playableSong = await _resolveSongIfNeeded(
          candidate,
          candidateQuality,
        );
        if (!isCurrentRequest()) {
          return false;
        }
        final playableQueue = List<Song>.unmodifiable(
          _replaceQueueSong(nextQueue, queueAnchor, playableSong),
        );
        return commitPlayableSong(
          playableSong,
          playableQueue,
          candidateQuality,
        );
      } catch (_) {
        if (!isCurrentRequest()) {
          return false;
        }
        return false;
      }
    }

    Future<List<Song>> loadFallbackCandidates() async {
      final cachedCandidates = fallbackCandidates;
      if (cachedCandidates != null) {
        return cachedCandidates;
      }
      final loadedCandidates = await _loadFallbackCandidates(song);
      fallbackCandidates = loadedCandidates;
      return loadedCandidates;
    }

    Future<Song?> tryFallbackSources(AudioQuality fallbackQuality) async {
      final candidates = await loadFallbackCandidates();
      if (!isCurrentRequest()) {
        return null;
      }
      for (final candidate in candidates) {
        final didCommit = await tryPlayableSong(
          candidate,
          fallbackQuality,
          queueAnchor: song,
        );
        if (!isCurrentRequest()) {
          return null;
        }
        if (didCommit) {
          return candidate;
        }
      }
      return null;
    }

    state = state.copyWith(
      currentSong: song,
      queue: nextQueue,
      isLoading: true,
      isPlaying: false,
      position: Duration.zero,
      duration: Duration.zero,
      audioQuality: quality,
      showQueue: false,
      showDownload: false,
      showMore: false,
      playbackNotice: null,
    );

    final localMatch = await _resolveLocalPlaybackIfAvailable(song, quality);
    if (!isCurrentRequest()) {
      return;
    }
    if (localMatch != null) {
      final localSong = localMatch.song;
      final localQueue = List<Song>.unmodifiable(
        _replaceQueueSong(nextQueue, song, localSong),
      );

      try {
        final didCommit = await commitPlayableSong(
          localSong,
          localQueue,
          localMatch.quality,
        );
        if (!didCommit) {
          return;
        }
        return;
      } catch (_) {
        if (!isCurrentRequest()) {
          return;
        }
        await _removeLocalPlaybackRecord(song, quality);
        if (!isCurrentRequest()) {
          return;
        }
        state = state.copyWith(
          currentSong: song,
          queue: nextQueue,
          isLoading: true,
          isPlaying: false,
          playbackNotice: '本地文件失效，正在尝试在线播放',
        );
      }
    }

    if (await tryPlayableSong(song, quality, queueAnchor: song)) {
      return;
    }
    if (!isCurrentRequest()) {
      return;
    }

    final fallbackSong = await tryFallbackSources(quality);
    if (!isCurrentRequest()) {
      return;
    }
    if (fallbackSong != null) {
      _showPlaybackNotice(
        '当前音源不可用，已切换 ${_sourceFullLabel(fallbackSong.source.wireValue)}',
      );
      return;
    }

    if (quality != AudioQuality.k128) {
      const fallbackQuality = AudioQuality.k128;
      if (await tryPlayableSong(song, fallbackQuality, queueAnchor: song)) {
        if (!isCurrentRequest()) {
          return;
        }
        _showPlaybackNotice('原音质不可用，已切换 128k');
        return;
      }
      if (!isCurrentRequest()) {
        return;
      }

      final fallbackQualitySong = await tryFallbackSources(fallbackQuality);
      if (!isCurrentRequest()) {
        return;
      }
      if (fallbackQualitySong != null) {
        _showPlaybackNotice(
          '当前音源不可用，已切换 ${_sourceFullLabel(fallbackQualitySong.source.wireValue)} · 128k',
        );
        return;
      }
    }

    state = state.copyWith(
      currentSong: song,
      queue: nextQueue,
      isLoading: false,
      isPlaying: false,
    );
    await _preferencesStore.saveCurrentSong(song);
    if (!isCurrentRequest()) {
      return;
    }
    await _preferencesStore.saveQueue(nextQueue);
    if (!isCurrentRequest()) {
      return;
    }
    _showPlaybackNotice('所有音源暂时不可用，请稍后重试');
  }

  void _applySnapshot(PlayerEngineSnapshot snapshot) {
    final previousProcessingState = _lastProcessingState;
    _lastProcessingState = snapshot.processingState;

    final currentSong = snapshot.currentSong;
    final ignoredSnapshotSongKey = _ignoredSnapshotSongKey;
    if (currentSong != null &&
        ignoredSnapshotSongKey != null &&
        currentSong.key == ignoredSnapshotSongKey &&
        state.currentSong == null &&
        state.queue.isEmpty) {
      return;
    }

    if (currentSong != null &&
        ignoredSnapshotSongKey != null &&
        currentSong.key != ignoredSnapshotSongKey) {
      _ignoredSnapshotSongKey = null;
    }

    final expectedSong = state.currentSong;
    if (currentSong != null &&
        expectedSong != null &&
        currentSong.key != expectedSong.key) {
      return;
    }

    final nextQueue = currentSong == null
        ? state.queue
        : _ensureSongInQueue(state.queue, currentSong);

    state = state.copyWith(
      currentSong: currentSong,
      queue: List<Song>.unmodifiable(nextQueue),
      isLoading: snapshot.isLoading,
      isPlaying: snapshot.isPlaying,
      position: snapshot.position,
      duration: snapshot.duration,
      audioQuality: snapshot.audioQuality,
    );

    if (currentSong == null) {
      _ignoredSnapshotSongKey = null;
    }

    if (previousProcessingState != PlayerEngineProcessingState.completed &&
        snapshot.processingState == PlayerEngineProcessingState.completed) {
      unawaited(_handlePlaybackCompleted());
    }

    unawaited(_preferencesStore.saveCurrentSong(currentSong));
    unawaited(_preferencesStore.saveQueue(state.queue));
    unawaited(_preferencesStore.saveAudioQuality(snapshot.audioQuality));
  }

  void _showPlaybackNotice(String message) {
    final noticeRevision = _playbackNoticeRevision + 1;
    _playbackNoticeRevision = noticeRevision;
    state = state.copyWith(playbackNotice: message);
    unawaited(
      Future<void>.delayed(const Duration(seconds: 3), () {
        if (_playbackNoticeRevision == noticeRevision) {
          state = state.copyWith(playbackNotice: null);
        }
      }),
    );
  }

  void _preloadNextSong(
    Song currentSong,
    List<Song> queue,
    AudioQuality quality,
  ) {
    if (queue.length < 2 || state.playMode == shufflePlayMode) {
      return;
    }

    final nextIndex = getNextQueueIndex(queue, currentSong, state.playMode);
    if (nextIndex < 0) {
      return;
    }

    final nextSong = queue[nextIndex];
    if (nextSong.key == currentSong.key ||
        nextSong.source == MusicSource.kuwo ||
        !_canResolveSong(nextSong)) {
      return;
    }

    final preloadCacheKey = '${nextSong.key}:${quality.wireValue}';
    if (_lastPreloadCacheKey == preloadCacheKey) {
      return;
    }
    _lastPreloadCacheKey = preloadCacheKey;

    unawaited(() async {
      try {
        await _resolveSongIfNeeded(nextSong, quality);
      } catch (_) {
        if (_lastPreloadCacheKey == preloadCacheKey) {
          _lastPreloadCacheKey = null;
        }
      }
    }());
  }

  Future<List<Song>> _loadFallbackCandidates(Song song) async {
    final search = _fallbackSongSearch;
    if (search == null) {
      return const <Song>[];
    }

    final query = _fallbackSearchQuery(song);
    if (query.isEmpty) {
      return const <Song>[];
    }

    final candidates = <Song>[];
    final originalSource = song.source.wireValue;
    for (final source in _playbackFallbackSources) {
      if (source == originalSource) {
        continue;
      }
      try {
        final results = await search(query, source);
        var addedForSource = 0;
        for (final candidate in results.take(_fallbackSearchLimit)) {
          if (addedForSource >= _fallbackCandidateLimit) {
            break;
          }
          if (!_isFallbackCandidate(candidate, song)) {
            continue;
          }
          candidates.add(candidate);
          addedForSource += 1;
        }
      } catch (_) {}
    }
    return candidates;
  }

  bool _isFallbackCandidate(Song candidate, Song originalSong) {
    if (candidate.source == originalSong.source) {
      return false;
    }
    if (!_hasPlayableId(candidate) || !_canAttemptPlayback(candidate)) {
      return false;
    }
    return _isLikelySameSong(candidate, originalSong);
  }

  bool _canAttemptPlayback(Song song) {
    final url = song.url?.trim();
    return (url != null && url.isNotEmpty) || _canResolveSong(song);
  }

  bool _hasPlayableId(Song song) {
    final id = song.id.trim();
    return id.isNotEmpty && !id.startsWith('temp-') && !id.startsWith('temp_');
  }

  bool _isLikelySameSong(Song candidate, Song originalSong) {
    final candidateName = _normalizeMatchText(candidate.name);
    final originalName = _normalizeMatchText(originalSong.name);
    if (candidateName.isEmpty || originalName.isEmpty) {
      return false;
    }
    final nameMatches =
        candidateName == originalName ||
        candidateName.contains(originalName) ||
        originalName.contains(candidateName);
    if (!nameMatches) {
      return false;
    }

    final originalArtists = _normalizedArtistParts(originalSong.artist);
    if (originalArtists.isEmpty) {
      return true;
    }
    final candidateArtist = _normalizeMatchText(candidate.artist);
    if (candidateArtist.isEmpty) {
      return false;
    }
    return originalArtists.any(
      (artist) =>
          candidateArtist.contains(artist) || artist.contains(candidateArtist),
    );
  }

  String _fallbackSearchQuery(Song song) {
    final name = song.name.trim();
    final artist = song.artist.trim();
    return <String>[name, artist].where((value) => value.isNotEmpty).join(' ');
  }

  List<String> _normalizedArtistParts(String artist) {
    return artist
        .split(RegExp(r'[,，、/&|;；]+'))
        .map(_normalizeMatchText)
        .where((value) => value.isNotEmpty)
        .toList(growable: false);
  }

  String _normalizeMatchText(String value) {
    return value.toLowerCase().replaceAll(
      RegExp(r'[\s\-_.,，、/\\|&+()（）【】\[\]{}<>《》:：;；!！?？·・]+'),
      '',
    );
  }

  String _sourceFullLabel(String source) {
    return _playbackSourceLabels[source] ?? source.toUpperCase();
  }

  Future<void> _handlePlaybackCompleted() async {
    if (_handlingCompletion || state.queue.isEmpty) {
      return;
    }

    _handlingCompletion = true;
    try {
      await playNext(force: false);
    } finally {
      _handlingCompletion = false;
    }
  }

  Song? _recoverSongFromQueue() {
    if (state.queue.isEmpty) {
      return null;
    }

    final stoppedSongKey = _lastStoppedSongKey;
    if (stoppedSongKey == null) {
      return state.queue.first;
    }

    for (final song in state.queue) {
      if (song.key == stoppedSongKey) {
        return song;
      }
    }

    return state.queue.first;
  }

  Future<Song> _resolveSongIfNeeded(Song song, AudioQuality quality) {
    if (!_canResolveSong(song)) {
      return Future<Song>.value(song);
    }

    final resolver = _resolveSongOverride;
    if (resolver == null) {
      return Future<Song>.value(song);
    }

    return resolver(song, quality);
  }

  Future<LocalPlaybackMatch?> _resolveLocalPlaybackIfAvailable(
    Song song,
    AudioQuality quality,
  ) {
    final resolver = _localPlaybackResolver;
    if (resolver == null) {
      return Future<LocalPlaybackMatch?>.value(null);
    }

    try {
      return resolver.resolve(song, quality);
    } catch (_) {
      return Future<LocalPlaybackMatch?>.value(null);
    }
  }

  Future<void> _removeLocalPlaybackRecord(Song song, AudioQuality quality) {
    final resolver = _localPlaybackResolver;
    if (resolver == null) {
      return Future<void>.value();
    }

    try {
      return resolver.remove(song, quality);
    } catch (_) {
      return Future<void>.value();
    }
  }

  bool _canResolveSong(Song song) {
    final url = song.url;
    if (url != null && url.isNotEmpty) {
      return false;
    }

    if (song.id.startsWith('temp-') || song.id.startsWith('temp_')) {
      return false;
    }

    return _gdStudioResolvableSources.contains(song.source.wireValue);
  }

  List<Song> _resolveQueue({required Song song, List<Song>? queue}) {
    if (queue == null || queue.isEmpty) {
      return _ensureSongInQueue(state.queue, song);
    }

    return _ensureSongInQueue(queue, song);
  }

  List<Song> _ensureSongInQueue(List<Song> queue, Song song) {
    final hasSong = queue.any((item) => item.key == song.key);
    if (hasSong) {
      return List<Song>.from(queue, growable: false);
    }

    return List<Song>.from(<Song>[...queue, song], growable: false);
  }

  List<Song> _replaceQueueSong(
    List<Song> queue,
    Song anchorSong,
    Song replacementSong,
  ) {
    var didReplace = false;
    final replacedQueue = <Song>[];
    final seenKeys = <String>{};
    for (final item in queue) {
      final nextItem = !didReplace && item.key == anchorSong.key
          ? replacementSong
          : item.key == replacementSong.key
          ? replacementSong
          : item;
      didReplace = didReplace || item.key == anchorSong.key;
      if (seenKeys.add(nextItem.key)) {
        replacedQueue.add(nextItem);
      }
    }
    if (!didReplace && seenKeys.add(replacementSong.key)) {
      replacedQueue.add(replacementSong);
    }
    return replacedQueue;
  }

  Duration _clampSeekPosition(Duration position) {
    if (position <= Duration.zero) {
      return Duration.zero;
    }

    final duration = state.duration;
    if (duration > Duration.zero && position > duration) {
      return duration;
    }

    return position;
  }

  Song _songFromTrack(PlayerTrack track) {
    return Song(
      id: track.id,
      name: track.title,
      artist: track.artist,
      pic: track.artworkUrl,
      url: track.streamUrl,
      lrc: track.lyrics,
      source: MusicSource(track.source),
    );
  }
}
