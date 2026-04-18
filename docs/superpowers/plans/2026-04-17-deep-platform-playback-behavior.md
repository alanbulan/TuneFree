# Deep Platform Playback Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the Flutter player so Android and iOS both behave like real media apps with background playback, system media controls, lifecycle coordination, playback-completion policy, and a documented verification checklist.

**Architecture:** Keep `PlayerController` as the single playback source of truth, keep `JustAudioPlayerEngine` responsible for factual playback execution, extend `AudioServiceMediaSessionAdapter` into a two-way media-session bridge, and add a dedicated lifecycle coordinator that translates interruption/noisy/media-command events into controller actions. Playback completion, stop/recover behavior, and queue/play-mode policy remain controller-owned so UI and system controls never diverge.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, just_audio, audio_service, audio_session, flutter_test

---

## Scope Check

This plan covers one subsystem: deep playback-platform behavior for the existing Flutter player runtime. It assumes the runtime/player milestone is already complete and intentionally does **not** include real download/file persistence, UI redesign, Android Auto, CarPlay, EQ, or casting.

## File Structure

- Create: `lib/features/player/application/media_session_remote_command.dart`
- Create: `lib/features/player/application/playback_lifecycle_coordinator.dart`
- Modify: `lib/features/player/application/media_session_adapter.dart`
- Modify: `lib/features/player/application/player_engine.dart`
- Modify: `lib/features/player/application/just_audio_player_engine.dart`
- Modify: `lib/features/player/application/player_controller.dart`
- Test: `test/features/player/application/media_session_adapter_test.dart`
- Test: `test/features/player/application/playback_lifecycle_coordinator_test.dart`
- Test: `test/features/player/application/just_audio_player_engine_test.dart`
- Test: `test/features/player/application/player_controller_runtime_test.dart`
- Test: `test/features/player/application/player_controller_test.dart`
- Create: `docs/superpowers/checklists/2026-04-17-deep-platform-playback-manual-checklist.md`

The new files keep responsibilities small:

- `media_session_remote_command.dart` owns the remote-command model only.
- `playback_lifecycle_coordinator.dart` owns interruption/noisy/remote-command orchestration only.
- `media_session_adapter.dart` remains the platform session bridge.
- `player_engine.dart`, `just_audio_player_engine.dart`, and `player_controller.dart` stay focused on runtime execution and business policy.

---

### Task 1: Add a media-session remote command bridge

**Files:**
- Create: `lib/features/player/application/media_session_remote_command.dart`
- Modify: `lib/features/player/application/media_session_adapter.dart`
- Test: `test/features/player/application/media_session_adapter_test.dart`

- [ ] **Step 1: Write the failing adapter test for remote commands**

Add this test to `test/features/player/application/media_session_adapter_test.dart` below the existing `clear` tests:

```dart
test('publishes remote commands through the adapter stream', () async {
  final adapter = AudioServiceMediaSessionAdapter(
    clientFactory: () async => FakeMediaSessionClient(),
    configureAudioSession: () async {},
  );
  final commands = <MediaSessionRemoteCommand>[];
  final subscription = adapter.remoteCommands.listen(commands.add);
  addTearDown(subscription.cancel);

  adapter.dispatchRemoteCommandForTest(const MediaSessionPlayCommand());
  adapter.dispatchRemoteCommandForTest(
    const MediaSessionSeekCommand(Duration(seconds: 9)),
  );

  await Future<void>.delayed(Duration.zero);

  expect(commands, hasLength(2));
  expect(commands.first, isA<MediaSessionPlayCommand>());
  expect(
    commands.last,
    isA<MediaSessionSeekCommand>().having(
      (value) => value.position,
      'position',
      const Duration(seconds: 9),
    ),
  );
});
```

Also add this import at the top of the file:

```dart
import 'package:tunefree/features/player/application/media_session_remote_command.dart';
```

- [ ] **Step 2: Run the adapter test to verify the bridge does not exist yet**

Run:

```bash
flutter test test/features/player/application/media_session_adapter_test.dart -r expanded
```

Expected: FAIL with errors about missing `remoteCommands`, missing `dispatchRemoteCommandForTest`, and missing remote command types.

- [ ] **Step 3: Create the remote command model**

Create `lib/features/player/application/media_session_remote_command.dart` with this content:

```dart
sealed class MediaSessionRemoteCommand {
  const MediaSessionRemoteCommand();
}

final class MediaSessionPlayCommand extends MediaSessionRemoteCommand {
  const MediaSessionPlayCommand();
}

final class MediaSessionPauseCommand extends MediaSessionRemoteCommand {
  const MediaSessionPauseCommand();
}

final class MediaSessionStopCommand extends MediaSessionRemoteCommand {
  const MediaSessionStopCommand();
}

final class MediaSessionSkipNextCommand extends MediaSessionRemoteCommand {
  const MediaSessionSkipNextCommand();
}

final class MediaSessionSkipPreviousCommand extends MediaSessionRemoteCommand {
  const MediaSessionSkipPreviousCommand();
}

final class MediaSessionSeekCommand extends MediaSessionRemoteCommand {
  const MediaSessionSeekCommand(this.position);

  final Duration position;
}
```

- [ ] **Step 4: Extend the adapter into a two-way bridge**

Update `lib/features/player/application/media_session_adapter.dart`.

First, add the new import and the stream requirement to the interface:

```dart
import 'dart:async';

import 'package:audio_service/audio_service.dart';
import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';

import '../../../core/models/song.dart';
import 'media_session_remote_command.dart';

abstract class MediaSessionAdapter {
  Stream<MediaSessionRemoteCommand> get remoteCommands;
  Future<void> updateMetadata(Song song, {required bool isPlaying});
  Future<void> updateProgress({required Duration position, required Duration duration});
  Future<void> clear();
}
```

Then add a command controller and a test-only dispatcher to `AudioServiceMediaSessionAdapter`:

```dart
final class AudioServiceMediaSessionAdapter implements MediaSessionAdapter {
  AudioServiceMediaSessionAdapter({
    MediaSessionClientFactory? clientFactory,
    AudioSessionConfigurator? configureAudioSession,
  })  : _clientFactory = clientFactory,
        _configureAudioSession = configureAudioSession ?? _defaultConfigureAudioSession,
        _sharePlatformSession = clientFactory == null && configureAudioSession == null,
        _remoteCommandController = StreamController<MediaSessionRemoteCommand>.broadcast();

  static Future<MediaSessionClient>? _sharedClientFuture;
  static Future<void>? _sharedAudioSessionConfigurationFuture;
  static final StreamController<MediaSessionRemoteCommand> _sharedRemoteCommandController =
      StreamController<MediaSessionRemoteCommand>.broadcast();

  final MediaSessionClientFactory? _clientFactory;
  final AudioSessionConfigurator _configureAudioSession;
  final bool _sharePlatformSession;
  final StreamController<MediaSessionRemoteCommand> _remoteCommandController;

  @override
  Stream<MediaSessionRemoteCommand> get remoteCommands =>
      (_sharePlatformSession ? _sharedRemoteCommandController : _remoteCommandController).stream;

  @visibleForTesting
  void dispatchRemoteCommandForTest(MediaSessionRemoteCommand command) {
    _dispatchRemoteCommand(command);
  }

  void _dispatchRemoteCommand(MediaSessionRemoteCommand command) {
    final controller = _sharePlatformSession ? _sharedRemoteCommandController : _remoteCommandController;
    controller.add(command);
  }
```

Update `_ensureClient()` so the default path builds an audio handler that can push commands back into the adapter:

```dart
Future<MediaSessionClient> _ensureClient() async {
  await _ensureAudioSessionConfigured();
  if (_sharePlatformSession) {
    return await (_sharedClientFuture ??= _createDefaultClient(_dispatchRemoteCommand));
  }
  return await (_clientFuture ??= (_clientFactory ?? () => _createDefaultClient(_dispatchRemoteCommand))());
}
```

Replace the old static `_defaultClientFactory()` with this instance factory:

```dart
Future<MediaSessionClient> _createDefaultClient(
  void Function(MediaSessionRemoteCommand command) dispatchCommand,
) async {
  final handler = await AudioService.init<_MediaSessionAudioHandler>(
    builder: () => _MediaSessionAudioHandler(dispatchCommand),
    config: const AudioServiceConfig(
      androidNotificationChannelId: 'com.alanbulan.tunefree.playback',
      androidNotificationChannelName: 'TuneFree Playback',
      androidNotificationOngoing: true,
    ),
  );
  return _AudioHandlerMediaSessionClient(handler);
}
```

Replace the private audio handler with command overrides:

```dart
final class _MediaSessionAudioHandler extends BaseAudioHandler {
  _MediaSessionAudioHandler(this._dispatchCommand);

  final void Function(MediaSessionRemoteCommand command) _dispatchCommand;

  @override
  Future<void> play() async {
    _dispatchCommand(const MediaSessionPlayCommand());
  }

  @override
  Future<void> pause() async {
    _dispatchCommand(const MediaSessionPauseCommand());
  }

  @override
  Future<void> stop() async {
    _dispatchCommand(const MediaSessionStopCommand());
  }

  @override
  Future<void> skipToNext() async {
    _dispatchCommand(const MediaSessionSkipNextCommand());
  }

  @override
  Future<void> skipToPrevious() async {
    _dispatchCommand(const MediaSessionSkipPreviousCommand());
  }

  @override
  Future<void> seek(Duration position) async {
    _dispatchCommand(MediaSessionSeekCommand(position));
  }
}
```

Finally, give `NoopMediaSessionAdapter` an empty command stream:

```dart
final class NoopMediaSessionAdapter implements MediaSessionAdapter {
  @override
  Stream<MediaSessionRemoteCommand> get remoteCommands => const Stream<MediaSessionRemoteCommand>.empty();

  @override
  Future<void> clear() async {}

  @override
  Future<void> updateMetadata(Song song, {required bool isPlaying}) async {}

  @override
  Future<void> updateProgress({required Duration position, required Duration duration}) async {}
}
```

- [ ] **Step 5: Run the focused adapter test and analyzer**

Run:

```bash
flutter test test/features/player/application/media_session_adapter_test.dart -r expanded
flutter analyze lib/features/player/application test/features/player/application/media_session_adapter_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the media-session bridge slice**

```bash
git add lib/features/player/application/media_session_remote_command.dart lib/features/player/application/media_session_adapter.dart test/features/player/application/media_session_adapter_test.dart

git commit -m "$(cat <<'EOF'
feat: bridge media session remote commands
EOF
)"
```

---

### Task 2: Add a playback lifecycle coordinator for interruptions, noisy events, and remote commands

**Files:**
- Create: `lib/features/player/application/playback_lifecycle_coordinator.dart`
- Test: `test/features/player/application/playback_lifecycle_coordinator_test.dart`

- [ ] **Step 1: Write the failing coordinator test**

Create `test/features/player/application/playback_lifecycle_coordinator_test.dart`:

```dart
import 'dart:async';

import 'package:audio_session/audio_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/application/media_session_remote_command.dart';
import 'package:tunefree/features/player/application/playback_lifecycle_coordinator.dart';

final class FakePlaybackLifecycleEventSource implements PlaybackLifecycleEventSource {
  final interruptionController = StreamController<AudioInterruptionEvent>.broadcast();
  final noisyController = StreamController<void>.broadcast();

  @override
  Stream<AudioInterruptionEvent> get interruptionEvents => interruptionController.stream;

  @override
  Stream<void> get becomingNoisyEvents => noisyController.stream;
}

void main() {
  test('coordinator routes remote commands and only resumes after pausing active playback', () async {
    final remoteCommands = StreamController<MediaSessionRemoteCommand>.broadcast();
    final eventSource = FakePlaybackLifecycleEventSource();
    var playing = false;
    var playCalls = 0;
    var pauseCalls = 0;
    var stopCalls = 0;
    var nextCalls = 0;
    var previousCalls = 0;
    Duration? lastSeek;

    final coordinator = PlaybackLifecycleCoordinator(
      remoteCommands: remoteCommands.stream,
      eventSource: eventSource,
      isPlaying: () => playing,
      onPlay: () async {
        playCalls += 1;
        playing = true;
      },
      onPause: () async {
        pauseCalls += 1;
        playing = false;
      },
      onStop: () async {
        stopCalls += 1;
        playing = false;
      },
      onSkipNext: () async {
        nextCalls += 1;
      },
      onSkipPrevious: () async {
        previousCalls += 1;
      },
      onSeek: (position) async {
        lastSeek = position;
      },
    );
    addTearDown(coordinator.dispose);
    addTearDown(remoteCommands.close);
    addTearDown(eventSource.interruptionController.close);
    addTearDown(eventSource.noisyController.close);

    remoteCommands.add(const MediaSessionPlayCommand());
    remoteCommands.add(const MediaSessionSkipNextCommand());
    remoteCommands.add(const MediaSessionSeekCommand(Duration(seconds: 14)));
    await pumpEventQueue();

    expect(playCalls, 1);
    expect(nextCalls, 1);
    expect(lastSeek, const Duration(seconds: 14));

    playing = true;
    eventSource.interruptionController.add(
      AudioInterruptionEvent(true, AudioInterruptionType.pause),
    );
    await pumpEventQueue();
    expect(pauseCalls, 1);

    eventSource.interruptionController.add(
      AudioInterruptionEvent(false, AudioInterruptionType.pause),
    );
    await pumpEventQueue();
    expect(playCalls, 2);

    playing = false;
    eventSource.interruptionController.add(
      AudioInterruptionEvent(true, AudioInterruptionType.pause),
    );
    eventSource.interruptionController.add(
      AudioInterruptionEvent(false, AudioInterruptionType.pause),
    );
    await pumpEventQueue();
    expect(playCalls, 2);

    playing = true;
    eventSource.noisyController.add(null);
    await pumpEventQueue();
    expect(pauseCalls, 2);
    expect(stopCalls, 0);
    expect(previousCalls, 0);
  });
}
```

- [ ] **Step 2: Run the coordinator test to verify the coordinator does not exist yet**

Run:

```bash
flutter test test/features/player/application/playback_lifecycle_coordinator_test.dart -r expanded
```

Expected: FAIL with missing `PlaybackLifecycleCoordinator` and `PlaybackLifecycleEventSource` errors.

- [ ] **Step 3: Create the coordinator and event-source boundary**

Create `lib/features/player/application/playback_lifecycle_coordinator.dart`:

```dart
import 'dart:async';

import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';

import 'media_session_remote_command.dart';

abstract class PlaybackLifecycleEventSource {
  Stream<AudioInterruptionEvent> get interruptionEvents;
  Stream<void> get becomingNoisyEvents;
}

final class AudioSessionPlaybackLifecycleEventSource
    implements PlaybackLifecycleEventSource {
  @override
  Stream<AudioInterruptionEvent> get interruptionEvents async* {
    final session = await AudioSession.instance;
    yield* session.interruptionEventStream;
  }

  @override
  Stream<void> get becomingNoisyEvents async* {
    final session = await AudioSession.instance;
    await for (final _ in session.becomingNoisyEventStream) {
      yield null;
    }
  }
}

final class NoopPlaybackLifecycleEventSource
    implements PlaybackLifecycleEventSource {
  const NoopPlaybackLifecycleEventSource();

  @override
  Stream<AudioInterruptionEvent> get interruptionEvents =>
      const Stream<AudioInterruptionEvent>.empty();

  @override
  Stream<void> get becomingNoisyEvents => const Stream<void>.empty();
}

typedef PlaybackStateReader = bool Function();
typedef PlaybackAction = Future<void> Function();
typedef PlaybackSeekAction = Future<void> Function(Duration position);

final class PlaybackLifecycleCoordinator {
  PlaybackLifecycleCoordinator({
    required Stream<MediaSessionRemoteCommand> remoteCommands,
    required PlaybackLifecycleEventSource eventSource,
    required PlaybackStateReader isPlaying,
    required PlaybackAction onPlay,
    required PlaybackAction onPause,
    required PlaybackAction onStop,
    required PlaybackAction onSkipNext,
    required PlaybackAction onSkipPrevious,
    required PlaybackSeekAction onSeek,
  })  : _isPlaying = isPlaying,
        _onPlay = onPlay,
        _onPause = onPause,
        _onStop = onStop,
        _onSkipNext = onSkipNext,
        _onSkipPrevious = onSkipPrevious,
        _onSeek = onSeek {
    _subscriptions.addAll([
      remoteCommands.listen(_handleRemoteCommand),
      eventSource.interruptionEvents.listen(_handleInterruptionEvent),
      eventSource.becomingNoisyEvents.listen(_handleBecomingNoisy),
    ]);
  }

  final PlaybackStateReader _isPlaying;
  final PlaybackAction _onPlay;
  final PlaybackAction _onPause;
  final PlaybackAction _onStop;
  final PlaybackAction _onSkipNext;
  final PlaybackAction _onSkipPrevious;
  final PlaybackSeekAction _onSeek;
  final List<StreamSubscription<dynamic>> _subscriptions =
      <StreamSubscription<dynamic>>[];

  bool _resumeAfterInterruption = false;

  Future<void> _handleRemoteCommand(MediaSessionRemoteCommand command) async {
    await _runGuarded(() async {
      switch (command) {
        case MediaSessionPlayCommand():
          await _onPlay();
        case MediaSessionPauseCommand():
          await _onPause();
        case MediaSessionStopCommand():
          await _onStop();
        case MediaSessionSkipNextCommand():
          await _onSkipNext();
        case MediaSessionSkipPreviousCommand():
          await _onSkipPrevious();
        case MediaSessionSeekCommand(position: final position):
          await _onSeek(position);
      }
    });
  }

  Future<void> _handleInterruptionEvent(AudioInterruptionEvent event) async {
    await _runGuarded(() async {
      if (event.begin) {
        if (!_isPlaying()) {
          _resumeAfterInterruption = false;
          return;
        }

        _resumeAfterInterruption = true;
        await _onPause();
        return;
      }

      if (_resumeAfterInterruption) {
        _resumeAfterInterruption = false;
        await _onPlay();
      }
    });
  }

  Future<void> _handleBecomingNoisy(void _) async {
    await _runGuarded(() async {
      if (_isPlaying()) {
        _resumeAfterInterruption = false;
        await _onPause();
      }
    });
  }

  Future<void> _runGuarded(Future<void> Function() action) async {
    try {
      await action();
    } catch (error) {
      debugPrint('PlaybackLifecycleCoordinator failed: $error');
    }
  }

  Future<void> dispose() async {
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
  }
}
```

- [ ] **Step 4: Run the coordinator test and analyzer**

Run:

```bash
flutter test test/features/player/application/playback_lifecycle_coordinator_test.dart -r expanded
flutter analyze lib/features/player/application/playback_lifecycle_coordinator.dart test/features/player/application/playback_lifecycle_coordinator_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the lifecycle coordination slice**

```bash
git add lib/features/player/application/playback_lifecycle_coordinator.dart test/features/player/application/playback_lifecycle_coordinator_test.dart

git commit -m "$(cat <<'EOF'
feat: coordinate playback lifecycle events
EOF
)"
```

---

### Task 3: Unify controller/system commands and formalize playback completion policy

**Files:**
- Modify: `lib/features/player/application/player_engine.dart`
- Modify: `lib/features/player/application/just_audio_player_engine.dart`
- Modify: `lib/features/player/application/player_controller.dart`
- Test: `test/features/player/application/player_controller_runtime_test.dart`
- Test: `test/features/player/application/player_controller_test.dart`
- Test: `test/features/player/application/just_audio_player_engine_test.dart`

- [ ] **Step 1: Write the failing controller tests for stop/recover and completion behavior**

Append this test-only engine to `test/features/player/application/player_controller_runtime_test.dart` above `void main()`:

```dart
final class FakeRuntimePlayerEngine implements PlayerEngine {
  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();
  int playCalls = 0;
  int pauseCalls = 0;
  int stopCalls = 0;
  int loadCalls = 0;
  Duration? lastSeekPosition;

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  PlayerEngineSnapshot get latestSnapshot => _snapshot;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    loadCalls += 1;
    _snapshot = _snapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: false,
      isPlaying: false,
      duration: const Duration(minutes: 4),
      position: Duration.zero,
      processingState: PlayerEngineProcessingState.ready,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> play() async {
    playCalls += 1;
    _snapshot = _snapshot.copyWith(
      isPlaying: true,
      processingState: PlayerEngineProcessingState.ready,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> pause() async {
    pauseCalls += 1;
    _snapshot = _snapshot.copyWith(isPlaying: false);
    _controller.add(_snapshot);
  }

  @override
  Future<void> seek(Duration position) async {
    lastSeekPosition = position;
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> stop() async {
    stopCalls += 1;
    _snapshot = _snapshot.copyWith(
      currentSong: null,
      isPlaying: false,
      isLoading: false,
      position: Duration.zero,
      duration: Duration.zero,
      processingState: PlayerEngineProcessingState.idle,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> clearMediaSession() async {}

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    _snapshot = _snapshot.copyWith(audioQuality: quality);
    _controller.add(_snapshot);
  }

  void emit(PlayerEngineSnapshot snapshot) {
    _snapshot = snapshot;
    _controller.add(snapshot);
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}
```

Then add these tests inside `main()`:

```dart
test('play recovers the last stopped queue item when the queue is still present', () async {
  final engine = FakeRuntimePlayerEngine();
  final store = InMemoryPlayerPreferencesStore();
  final controller = PlayerController.runtime(
    engine: engine,
    preferencesStore: store,
    mediaSessionAdapter: NoopMediaSessionAdapter(),
    lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
  );
  addTearDown(controller.disposeController);

  const song = Song(
    id: 'resume-song',
    name: 'Resume Song',
    artist: 'TuneFree',
    source: MusicSource.netease,
    url: 'https://example.com/resume.mp3',
  );

  await controller.playSong(song, queue: const <Song>[song]);
  await controller.stop();
  await controller.play();

  expect(engine.stopCalls, 1);
  expect(engine.loadCalls, 2);
  expect(controller.state.currentSong?.key, 'netease:resume-song');
});

test('completed snapshots use the controller play-mode policy', () async {
  final engine = FakeRuntimePlayerEngine();
  final store = InMemoryPlayerPreferencesStore();
  final controller = PlayerController.runtime(
    engine: engine,
    preferencesStore: store,
    mediaSessionAdapter: NoopMediaSessionAdapter(),
    lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
  );
  addTearDown(controller.disposeController);

  const song = Song(
    id: 'loop-song',
    name: 'Loop Song',
    artist: 'TuneFree',
    source: MusicSource.netease,
    url: 'https://example.com/loop.mp3',
  );

  await controller.playSong(song, queue: const <Song>[song]);
  controller.togglePlayMode();
  expect(controller.state.playMode, 'loop');

  engine.emit(
    engine.latestSnapshot.copyWith(
      isPlaying: false,
      processingState: PlayerEngineProcessingState.completed,
    ),
  );
  await Future<void>.delayed(Duration.zero);

  expect(engine.lastSeekPosition, Duration.zero);
  expect(engine.playCalls, greaterThanOrEqualTo(2));
});
```

Add these imports at the top of the same file:

```dart
import 'package:tunefree/features/player/application/playback_lifecycle_coordinator.dart';
import 'package:tunefree/features/player/application/player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
```

- [ ] **Step 2: Run the runtime test to verify stop/recover/completion APIs are missing**

Run:

```bash
flutter test test/features/player/application/player_controller_runtime_test.dart -r expanded
```

Expected: FAIL because `PlayerEngineProcessingState`, `PlayerEngine.stop()`, and the new `PlayerController.runtime(...)` arguments do not exist yet.

- [ ] **Step 3: Add processing state and stop support to the engine contract**

Update `lib/features/player/application/player_engine.dart` to this shape:

```dart
import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

enum PlayerEngineProcessingState { idle, loading, ready, completed }

class PlayerEngineSnapshot {
  const PlayerEngineSnapshot({
    this.currentSong,
    this.isLoading = false,
    this.isPlaying = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.audioQuality = AudioQuality.k320,
    this.processingState = PlayerEngineProcessingState.idle,
  });

  static const Object _currentSongUnchanged = Object();

  final Song? currentSong;
  final bool isLoading;
  final bool isPlaying;
  final Duration position;
  final Duration duration;
  final AudioQuality audioQuality;
  final PlayerEngineProcessingState processingState;

  PlayerEngineSnapshot copyWith({
    Object? currentSong = _currentSongUnchanged,
    bool? isLoading,
    bool? isPlaying,
    Duration? position,
    Duration? duration,
    AudioQuality? audioQuality,
    PlayerEngineProcessingState? processingState,
  }) {
    return PlayerEngineSnapshot(
      currentSong: identical(currentSong, _currentSongUnchanged)
          ? this.currentSong
          : currentSong as Song?,
      isLoading: isLoading ?? this.isLoading,
      isPlaying: isPlaying ?? this.isPlaying,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      audioQuality: audioQuality ?? this.audioQuality,
      processingState: processingState ?? this.processingState,
    );
  }
}

abstract class PlayerEngine {
  Stream<PlayerEngineSnapshot> get snapshots;
  PlayerEngineSnapshot get latestSnapshot;
  Future<void> loadSong(Song song, {required AudioQuality quality});
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> stop();
  Future<void> clearMediaSession();
  Future<void> setAudioQuality(AudioQuality quality);
  Future<void> dispose();
}
```

- [ ] **Step 4: Teach `JustAudioPlayerEngine` about stop and completion state**

Update `lib/features/player/application/just_audio_player_engine.dart`.

First extend the adapter interface:

```dart
abstract class AudioPlayerAdapter {
  Stream<PlayerState> get playerStateStream;
  Stream<Duration> get positionStream;
  Stream<Duration?> get durationStream;
  Duration? get duration;
  Future<Duration?> setUrl(String url);
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> stop();
  Future<void> dispose();
}

final class JustAudioPlayerAdapter implements AudioPlayerAdapter {
  JustAudioPlayerAdapter(this._audioPlayer);

  final AudioPlayer _audioPlayer;

  @override
  Stream<PlayerState> get playerStateStream => _audioPlayer.playerStateStream;

  @override
  Stream<Duration> get positionStream => _audioPlayer.positionStream;

  @override
  Stream<Duration?> get durationStream => _audioPlayer.durationStream;

  @override
  Duration? get duration => _audioPlayer.duration;

  @override
  Future<Duration?> setUrl(String url) => _audioPlayer.setUrl(url);

  @override
  Future<void> play() => _audioPlayer.play();

  @override
  Future<void> pause() => _audioPlayer.pause();

  @override
  Future<void> seek(Duration position) => _audioPlayer.seek(position);

  @override
  Future<void> stop() => _audioPlayer.stop();

  @override
  Future<void> dispose() => _audioPlayer.dispose();
}
```

Set processing state during load and add stop:

```dart
@override
Future<void> loadSong(Song song, {required AudioQuality quality}) async {
  _emit(
    _latestSnapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: true,
      isPlaying: false,
      position: Duration.zero,
      duration: Duration.zero,
      processingState: PlayerEngineProcessingState.loading,
    ),
  );

  if (_testMode) {
    _emit(
      _latestSnapshot.copyWith(
        isLoading: false,
        duration: const Duration(minutes: 4, seconds: 56),
        processingState: PlayerEngineProcessingState.ready,
      ),
    );
    return;
  }

  final url = song.url;
  if (url == null || url.isEmpty) {
    _emit(
      _latestSnapshot.copyWith(
        isLoading: false,
        processingState: PlayerEngineProcessingState.idle,
      ),
    );
    return;
  }

  await _runPlayerCall(() async {
    await _audioPlayer!.setUrl(url);
    _emit(
      _latestSnapshot.copyWith(
        isLoading: false,
        duration: _audioPlayer.duration ?? Duration.zero,
        processingState: PlayerEngineProcessingState.ready,
      ),
    );
  });
}

@override
Future<void> stop() async {
  await _runPlayerCall(() async {
    if (_testMode) {
      _emit(
        _latestSnapshot.copyWith(
          currentSong: null,
          isPlaying: false,
          isLoading: false,
          position: Duration.zero,
          duration: Duration.zero,
          processingState: PlayerEngineProcessingState.idle,
        ),
      );
    } else {
      await _audioPlayer!.stop();
      _emit(
        _latestSnapshot.copyWith(
          currentSong: null,
          isPlaying: false,
          isLoading: false,
          position: Duration.zero,
          duration: Duration.zero,
          processingState: PlayerEngineProcessingState.idle,
        ),
      );
    }
  });
}
```

Map `just_audio` processing states in the listener:

```dart
void _bindAudioPlayerStreams() {
  _subscriptions.addAll([
    _audioPlayer!.playerStateStream.listen((state) {
      _emit(
        _latestSnapshot.copyWith(
          isPlaying: state.playing,
          isLoading: _isPlayerLoading(state.playing, state.processingState),
          processingState: _mapProcessingState(state.processingState),
        ),
      );
    }),
    _audioPlayer.positionStream.listen((position) {
      _emit(_latestSnapshot.copyWith(position: position));
    }),
    _audioPlayer.durationStream.listen((duration) {
      _emit(_latestSnapshot.copyWith(duration: duration ?? Duration.zero));
    }),
  ]);
}

PlayerEngineProcessingState _mapProcessingState(ProcessingState? processingState) {
  if (processingState == null) {
    return _latestSnapshot.processingState;
  }

  return switch (processingState) {
    ProcessingState.idle => PlayerEngineProcessingState.idle,
    ProcessingState.loading || ProcessingState.buffering => PlayerEngineProcessingState.loading,
    ProcessingState.ready => PlayerEngineProcessingState.ready,
    ProcessingState.completed => PlayerEngineProcessingState.completed,
  };
}
```

- [ ] **Step 5: Wire controller-owned stop/recover/completion behavior**

Update `lib/features/player/application/player_controller.dart`.

Add the new import and pass the adapter into runtime initialization:

```dart
import 'playback_lifecycle_coordinator.dart';

final playerEngineProvider = Provider<PlayerEngine>((ref) {
  final mediaSessionAdapter = ref.watch(mediaSessionAdapterProvider);
  final engine = JustAudioPlayerEngine.real(mediaSessionAdapter: mediaSessionAdapter);
  ref.onDispose(engine.dispose);
  return engine;
});

final mediaSessionAdapterProvider = Provider<MediaSessionAdapter>((ref) {
  return AudioServiceMediaSessionAdapter();
});
```

Update the runtime constructor and build path so both provide the adapter and a lifecycle event source:

```dart
final class PlayerController extends ChangeNotifier with _PlayerControllerRuntimeApi {
  PlayerController.runtime({
    required PlayerEngine engine,
    required PlayerPreferencesStore preferencesStore,
    SongResolutionRepository? songResolutionRepository,
    MediaSessionAdapter? mediaSessionAdapter,
    PlaybackLifecycleEventSource? lifecycleEventSource,
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
    );
  }
}
```

```dart
initializeRuntime(
  engine: ref.read(playerEngineProvider),
  preferencesStore: ref.read(playerPreferencesStoreProvider),
  mediaSessionAdapter: ref.read(mediaSessionAdapterProvider),
  lifecycleEventSource: AudioSessionPlaybackLifecycleEventSource(),
  resolveSongOverride: (song, quality) => ref
      .read(songResolutionRepositoryProvider)
      .resolveSong(song, quality: quality.wireValue),
);
```

Add fields for lifecycle coordination and stop/recovery state:

```dart
late final MediaSessionAdapter _mediaSessionAdapter;
PlaybackLifecycleCoordinator? _playbackLifecycleCoordinator;
PlayerEngineProcessingState _lastProcessingState = PlayerEngineProcessingState.idle;
bool _handlingCompletion = false;
String? _lastStoppedSongKey;
```

Update `initializeRuntime(...)` to create the coordinator:

```dart
void initializeRuntime({
  required PlayerEngine engine,
  required PlayerPreferencesStore preferencesStore,
  required MediaSessionAdapter mediaSessionAdapter,
  required PlaybackLifecycleEventSource lifecycleEventSource,
  PlayerSongResolver? resolveSongOverride,
}) {
  _engine = engine;
  _preferencesStore = preferencesStore;
  _mediaSessionAdapter = mediaSessionAdapter;
  _resolveSongOverride = resolveSongOverride;
  _subscription = _engine.snapshots.listen(_applySnapshot);
  _playbackLifecycleCoordinator = PlaybackLifecycleCoordinator(
    remoteCommands: mediaSessionAdapter.remoteCommands,
    eventSource: lifecycleEventSource,
    isPlaying: () => state.isPlaying,
    onPlay: play,
    onPause: pause,
    onStop: stop,
    onSkipNext: () => playNext(),
    onSkipPrevious: playPrev,
    onSeek: seek,
  );
  unawaited(_hydrateFromPreferences());
}
```

Add explicit `play`, `pause`, and `stop` methods and make `togglePlay()` use them:

```dart
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
  _playbackMutationRevision += 1;
  _ignoredSnapshotSongKey = null;
  _lastStoppedSongKey = state.currentSong?.key ?? _lastStoppedSongKey;
  await _engine.stop();
  await _engine.clearMediaSession();
  state = state.copyWith(
    currentSong: null,
    isPlaying: false,
    isLoading: false,
    position: Duration.zero,
    duration: Duration.zero,
  );
  await _preferencesStore.saveCurrentSong(null);
  await _preferencesStore.saveQueue(state.queue);
}

Future<void> togglePlay() async {
  if (state.isPlaying) {
    await pause();
    return;
  }

  await play();
}
```

Handle completion in `_applySnapshot` and add recovery helpers:

```dart
void _applySnapshot(PlayerEngineSnapshot snapshot) {
  final previousProcessingState = _lastProcessingState;
  _lastProcessingState = snapshot.processingState;

  final currentSong = snapshot.currentSong;
  final ignoredSnapshotSongKey = _ignoredSnapshotSongKey;
  if (
    currentSong != null &&
    ignoredSnapshotSongKey != null &&
    currentSong.key == ignoredSnapshotSongKey &&
    state.currentSong == null &&
    state.queue.isEmpty
  ) {
    return;
  }

  if (currentSong != null &&
      ignoredSnapshotSongKey != null &&
      currentSong.key != ignoredSnapshotSongKey) {
    _ignoredSnapshotSongKey = null;
  }

  final nextQueue =
      currentSong == null ? state.queue : _ensureSongInQueue(state.queue, currentSong);

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
```

Dispose the coordinator:

```dart
Future<void> disposeController({bool disposeEngine = true}) async {
  await _subscription?.cancel();
  await _playbackLifecycleCoordinator?.dispose();
  if (disposeEngine) {
    await _engine.dispose();
  }
}
```

- [ ] **Step 6: Update the existing fake engine in `player_controller_test.dart` to satisfy the expanded interface**

In `test/features/player/application/player_controller_test.dart`, update `FakePlayerEngine` like this:

```dart
class FakePlayerEngine implements PlayerEngine {
  // existing fields stay in place

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    loadCalls += 1;

    if (_loadCompleter != null && _delayedLoadCall == loadCalls) {
      await _loadCompleter.future;
    }

    _snapshot = _snapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: false,
      isPlaying: false,
      duration: const Duration(minutes: 3, seconds: 12),
      position: Duration.zero,
      processingState: PlayerEngineProcessingState.ready,
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> stop() async {
    _snapshot = _snapshot.copyWith(
      currentSong: null,
      isPlaying: false,
      isLoading: false,
      position: Duration.zero,
      duration: Duration.zero,
      processingState: PlayerEngineProcessingState.idle,
    );
    _controller.add(_snapshot);
  }
}
```

- [ ] **Step 7: Run the focused player tests and analyzer**

Run:

```bash
flutter test test/features/player/application/player_controller_runtime_test.dart -r expanded
flutter test test/features/player/application/player_controller_test.dart -r expanded
flutter test test/features/player/application/just_audio_player_engine_test.dart -r expanded
flutter analyze lib/features/player/application test/features/player/application/player_controller_runtime_test.dart test/features/player/application/player_controller_test.dart test/features/player/application/just_audio_player_engine_test.dart
```

Expected: PASS / PASS / PASS / `No issues found!`

- [ ] **Step 8: Commit the unified controller/completion slice**

```bash
git add lib/features/player/application/player_engine.dart lib/features/player/application/just_audio_player_engine.dart lib/features/player/application/player_controller.dart test/features/player/application/player_controller_runtime_test.dart test/features/player/application/player_controller_test.dart test/features/player/application/just_audio_player_engine_test.dart

git commit -m "$(cat <<'EOF'
feat: unify platform playback control flow
EOF
)"
```

---

### Task 4: Harden media-session synchronization, supported controls, and publish diagnostics

**Files:**
- Modify: `lib/features/player/application/media_session_adapter.dart`
- Modify: `lib/features/player/application/just_audio_player_engine.dart`
- Test: `test/features/player/application/media_session_adapter_test.dart`
- Test: `test/features/player/application/just_audio_player_engine_test.dart`

- [ ] **Step 1: Write the failing tests for richer controls and progress publication**

Add this test to `test/features/player/application/media_session_adapter_test.dart`:

```dart
test('publishes next and previous controls for an active media item', () async {
  final client = FakeMediaSessionClient();
  final adapter = AudioServiceMediaSessionAdapter(
    clientFactory: () async => client,
    configureAudioSession: () async {},
  );

  await adapter.updateMetadata(song, isPlaying: true);

  expect(client.playbackState.controls, hasLength(4));
  expect(client.playbackState.controls.first, MediaControl.skipToPrevious);
  expect(client.playbackState.controls[1], MediaControl.pause);
  expect(client.playbackState.controls[2], MediaControl.skipToNext);
  expect(client.playbackState.controls.last, MediaControl.stop);
  expect(client.playbackState.systemActions, contains(MediaAction.seekForward));
  expect(client.playbackState.systemActions, contains(MediaAction.seekBackward));
});
```

Add this test to `test/features/player/application/just_audio_player_engine_test.dart`:

```dart
test('loadSong publishes paused metadata and throttled progress updates', () async {
  final audioPlayer = FakeAudioPlayerAdapter()..emitDuration(const Duration(minutes: 5));
  final mediaSession = FakeMediaSessionAdapter();
  final engine = JustAudioPlayerEngine.withAudioPlayer(
    mediaSessionAdapter: mediaSession,
    audioPlayer: audioPlayer,
  );
  addTearDown(engine.dispose);

  await engine.loadSong(song, quality: AudioQuality.k320);
  expect(mediaSession.lastMetadataSong, song);
  expect(mediaSession.lastMetadataIsPlaying, isFalse);

  audioPlayer.emitPosition(const Duration(seconds: 1));
  await Future<void>.delayed(Duration.zero);
  expect(mediaSession.lastProgressPosition, const Duration(seconds: 1));
  expect(mediaSession.lastProgressDuration, const Duration(minutes: 5));
});
```

- [ ] **Step 2: Run the focused tests to verify richer synchronization does not exist yet**

Run:

```bash
flutter test test/features/player/application/media_session_adapter_test.dart -r expanded
flutter test test/features/player/application/just_audio_player_engine_test.dart -r expanded
```

Expected: FAIL because the adapter still publishes only play/pause+stop and the engine does not publish metadata on `loadSong()` or progress from the position stream.

- [ ] **Step 3: Expand controls and diagnostics in the adapter**

Update `lib/features/player/application/media_session_adapter.dart`.

First add a simple logger:

```dart
void _logPlatformSyncFailure(String context, Object error) {
  debugPrint('AudioServiceMediaSessionAdapter $context failed: $error');
}
```

Wrap `setMediaItem` / `setPlaybackState` calls in `clear()`, `updateMetadata()`, and `updateProgress()` so failures are logged before rethrowing:

```dart
try {
  await client.setMediaItem(_mediaItem);
  await client.setPlaybackState(_playbackState);
} catch (error) {
  _logPlatformSyncFailure('updateMetadata', error);
  rethrow;
}
```

Replace `_buildPlaybackState(...)` with richer controls and actions:

```dart
PlaybackState _buildPlaybackState({
  required bool isPlaying,
  required AudioProcessingState processingState,
  required Duration position,
}) {
  final controls = <MediaControl>[
    MediaControl.skipToPrevious,
    if (isPlaying) MediaControl.pause else MediaControl.play,
    MediaControl.skipToNext,
    MediaControl.stop,
  ];

  return _playbackState.copyWith(
    processingState: processingState,
    playing: isPlaying,
    controls: controls,
    androidCompactActionIndices: const <int>[0, 1, 2],
    systemActions: const <MediaAction>{
      MediaAction.seek,
      MediaAction.seekForward,
      MediaAction.seekBackward,
    },
    updatePosition: position,
    bufferedPosition: position,
  );
}
```

- [ ] **Step 4: Publish metadata on load and progress on position changes**

Update `lib/features/player/application/just_audio_player_engine.dart`.

Add the Flutter foundation import and state for throttling progress:

```dart
import 'package:flutter/foundation.dart';

int _lastPublishedProgressSecond = -1;
```

Publish paused metadata after a successful load:

```dart
await _runPlayerCall(() async {
  await _audioPlayer!.setUrl(url);
  _emit(
    _latestSnapshot.copyWith(
      isLoading: false,
      duration: _audioPlayer.duration ?? Duration.zero,
      processingState: PlayerEngineProcessingState.ready,
    ),
  );
  await _safeUpdateMetadata(song, isPlaying: false);
});
```

Throttle progress publication from the position stream:

```dart
_audioPlayer.positionStream.listen((position) {
  _emit(_latestSnapshot.copyWith(position: position));
  final second = position.inSeconds;
  if (second == _lastPublishedProgressSecond) {
    return;
  }
  _lastPublishedProgressSecond = second;
  unawaited(
    _safeUpdateProgress(
      position: position,
      duration: _latestSnapshot.duration,
    ),
  );
}),
```

Add lightweight logs for non-fatal publish failures:

```dart
Future<void> _safeUpdateMetadata(Song song, {required bool isPlaying}) async {
  try {
    await _mediaSessionAdapter.updateMetadata(song, isPlaying: isPlaying);
  } catch (error) {
    debugPrint('JustAudioPlayerEngine updateMetadata failed: $error');
  }
}

Future<void> _safeUpdateProgress({
  required Duration position,
  required Duration duration,
}) async {
  try {
    await _mediaSessionAdapter.updateProgress(position: position, duration: duration);
  } catch (error) {
    debugPrint('JustAudioPlayerEngine updateProgress failed: $error');
  }
}
```

- [ ] **Step 5: Run the focused tests and analyzer**

Run:

```bash
flutter test test/features/player/application/media_session_adapter_test.dart -r expanded
flutter test test/features/player/application/just_audio_player_engine_test.dart -r expanded
flutter analyze lib/features/player/application test/features/player/application/media_session_adapter_test.dart test/features/player/application/just_audio_player_engine_test.dart
```

Expected: PASS / PASS / `No issues found!`

- [ ] **Step 6: Commit the synchronization hardening slice**

```bash
git add lib/features/player/application/media_session_adapter.dart lib/features/player/application/just_audio_player_engine.dart test/features/player/application/media_session_adapter_test.dart test/features/player/application/just_audio_player_engine_test.dart

git commit -m "$(cat <<'EOF'
fix: harden media session state sync
EOF
)"
```

---

### Task 5: Add the dual-platform manual verification checklist and run the final regression sweep

**Files:**
- Create: `docs/superpowers/checklists/2026-04-17-deep-platform-playback-manual-checklist.md`
- Modify: `test/features/player/application/player_controller_runtime_test.dart`
- Modify: `test/features/player/application/playback_lifecycle_coordinator_test.dart`

- [ ] **Step 1: Create the manual verification checklist document**

Create `docs/superpowers/checklists/2026-04-17-deep-platform-playback-manual-checklist.md`:

```markdown
# Deep Platform Playback Manual Verification Checklist

## Android

- [ ] Start playback in the foreground and confirm title, artist, artwork, and progress appear in the system notification.
- [ ] Lock the device and confirm play/pause/previous/next/stop controls match the in-app player state.
- [ ] Background the app and confirm playback continues without UI drift when the app is reopened.
- [ ] Trigger a media-button play/pause action from a headset or Bluetooth device and confirm the app responds once.
- [ ] Trigger a noisy-device event (headphones unplugged) and confirm playback pauses without auto-resume.
- [ ] Trigger an interruption/focus-loss scenario and confirm playback pauses, then resumes only when it had been playing before the interruption.
- [ ] Let a song complete in `sequence`, `loop`, and `shuffle` modes and confirm the next action matches the app queue rules.

## iOS

- [ ] Start playback in the foreground and confirm Now Playing metadata appears on the lock screen/control center.
- [ ] Lock the device and confirm play/pause/previous/next controls match the in-app player state.
- [ ] Background the app and confirm playback continues, then reopen the app and verify the Flutter UI matches the real playback state.
- [ ] Trigger an interruption scenario and confirm playback pauses, then resumes only when it had been playing before the interruption.
- [ ] Use lock screen or control center seeking if available and confirm the app position updates correctly.
- [ ] Let a song complete in `sequence`, `loop`, and `shuffle` modes and confirm the next action matches the app queue rules.
```

- [ ] **Step 2: Add a final regression test for stop-state command recovery**

Append this test to `test/features/player/application/player_controller_runtime_test.dart`:

```dart
test('stop leaves the queue intact so system play can recover later', () async {
  final engine = FakeRuntimePlayerEngine();
  final store = InMemoryPlayerPreferencesStore();
  final controller = PlayerController.runtime(
    engine: engine,
    preferencesStore: store,
    mediaSessionAdapter: NoopMediaSessionAdapter(),
    lifecycleEventSource: const NoopPlaybackLifecycleEventSource(),
  );
  addTearDown(controller.disposeController);

  const firstSong = Song(
    id: 'first',
    name: 'First Song',
    artist: 'TuneFree',
    source: MusicSource.netease,
    url: 'https://example.com/first.mp3',
  );
  const secondSong = Song(
    id: 'second',
    name: 'Second Song',
    artist: 'TuneFree',
    source: MusicSource.netease,
    url: 'https://example.com/second.mp3',
  );

  await controller.playSong(firstSong, queue: const <Song>[firstSong, secondSong]);
  await controller.stop();

  expect(controller.state.currentSong, isNull);
  expect(controller.state.queue.map((song) => song.key), <String>[
    'netease:first',
    'netease:second',
  ]);
});
```

- [ ] **Step 3: Re-run the focused player-platform suite**

Run:

```bash
flutter test test/features/player/application/media_session_adapter_test.dart -r expanded
flutter test test/features/player/application/playback_lifecycle_coordinator_test.dart -r expanded
flutter test test/features/player/application/player_controller_runtime_test.dart -r expanded
flutter test test/features/player/application/player_controller_test.dart -r expanded
flutter test test/features/player/application/just_audio_player_engine_test.dart -r expanded
```

Expected: PASS / PASS / PASS / PASS / PASS

- [ ] **Step 4: Run the broad verification suite**

Run:

```bash
flutter test
flutter analyze
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the checklist and verification slice**

```bash
git add docs/superpowers/checklists/2026-04-17-deep-platform-playback-manual-checklist.md test/features/player/application/player_controller_runtime_test.dart test/features/player/application/playback_lifecycle_coordinator_test.dart

git commit -m "$(cat <<'EOF'
docs: add deep playback verification checklist
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers every major behavior from `docs/superpowers/specs/2026-04-17-deep-platform-playback-behavior-design.md`:

- two-way media-session command flow
- lifecycle coordination for interruptions and noisy-device events
- controller-owned stop/recover behavior
- playback-completion policy via play-mode rules
- richer media-session controls, progress sync, and diagnostics
- documented Android/iOS manual verification checklist

### Placeholder scan

No `TODO`, `TBD`, or “implement later” placeholders remain. Every task includes exact file paths, code, commands, and expected results.

### Type consistency

The plan introduces these concrete types and uses them consistently across later tasks:

- `MediaSessionRemoteCommand`
- `PlaybackLifecycleEventSource`
- `PlaybackLifecycleCoordinator`
- `PlayerEngineProcessingState`
- `PlayerEngine.stop()`

Later tasks reference the same names and do not rename them.
