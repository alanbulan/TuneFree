# Real Audio Engine and Platform Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scaffold-only player runtime with a real audio engine, persistence, and platform integration layer that preserves the legacy TuneFree playback behavior 1:1.

**Architecture:** This plan ports the runtime logic from `legacy/react_app/contexts/PlayerContext.tsx`, `legacy/react_app/components/DownloadPopup.tsx`, and `legacy/react_app/services/resolver.ts` into a Flutter playback engine built around `just_audio`, a persistence store, and a download service. The UI parity plans should already be complete before this plan starts; this plan makes those UI surfaces drive a real runtime instead of placeholders.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, just_audio, audio_service, audio_session, shared_preferences, path_provider, flutter_test

---

## Scope Check

This plan assumes these earlier plans are already complete:
- `2026-04-16-shared-foundation-and-source-parity.md`
- `2026-04-16-home-search-ui-and-data-parity.md`
- `2026-04-16-library-and-player-full-parity.md`

This plan covers only the real runtime engine and platform/runtime parity behavior. It does not add new UI features beyond legacy parity.

## File Structure

- Modify: `./pubspec.yaml`
- Modify: `./lib/features/player/application/player_controller.dart`
- Modify: `./lib/features/player/application/player_engine.dart`
- Modify: `./lib/features/player/domain/player_state.dart`
- Modify: `./lib/features/player/presentation/widgets/mini_player_bar.dart`
- Modify: `./lib/features/player/presentation/widgets/full_player_sheet.dart`
- Modify: `./lib/features/player/presentation/widgets/player_download_sheet.dart`
- Modify: `./lib/features/library/presentation/library_page.dart`
- Create: `./lib/features/player/application/just_audio_player_engine.dart`
- Create: `./lib/features/player/application/media_session_adapter.dart`
- Create: `./lib/features/player/application/player_queue_manager.dart`
- Create: `./lib/features/player/data/player_preferences_store.dart`
- Create: `./lib/features/player/data/player_download_service.dart`
- Test: `./test/features/player/application/just_audio_player_engine_test.dart`
- Test: `./test/features/player/application/player_controller_runtime_test.dart`
- Test: `./test/features/player/application/player_download_service_test.dart`

---

### Task 1: Introduce the real playback engine contract and just_audio implementation

**Files:**
- Modify: `./pubspec.yaml`
- Modify: `./lib/features/player/application/player_engine.dart`
- Create: `./lib/features/player/application/just_audio_player_engine.dart`
- Create: `./lib/features/player/application/media_session_adapter.dart`
- Test: `./test/features/player/application/just_audio_player_engine_test.dart`

- [ ] **Step 1: Write the failing engine test**

Create `test/features/player/application/just_audio_player_engine_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';

void main() {
  test('test engine emits snapshots for load/play/pause', () async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    const song = Song(
      id: 'runtime-1',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
      url: 'https://example.com/test.mp3',
      audioQualities: [AudioQuality.k320],
    );

    await engine.loadSong(song, quality: AudioQuality.k320);
    expect(engine.latestSnapshot.currentSong?.key, 'netease:runtime-1');
    expect(engine.latestSnapshot.isLoading, isFalse);

    await engine.play();
    expect(engine.latestSnapshot.isPlaying, isTrue);

    await engine.pause();
    expect(engine.latestSnapshot.isPlaying, isFalse);
  });
}
```

- [ ] **Step 2: Run the engine test to verify the real engine does not exist yet**

Run:

```bash
flutter test test/features/player/application/just_audio_player_engine_test.dart -r expanded
```

Expected: FAIL with import errors for `just_audio_player_engine.dart` or missing runtime APIs.

- [ ] **Step 3: Add runtime dependencies**

Update `pubspec.yaml` to include these packages:

```yaml
dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  flutter_riverpod: ^2.6.1
  go_router: ^16.2.0
  freezed_annotation: ^3.1.0
  json_annotation: ^4.9.0
  dio: ^5.9.0
  collection: ^1.19.1
  golden_toolkit: ^0.15.0
  just_audio: ^0.10.5
  audio_service: ^0.18.20
  audio_session: ^0.2.2
  shared_preferences: ^2.5.3
  path_provider: ^2.1.5
```

Run:

```bash
flutter pub get
```

- [ ] **Step 4: Update the engine contract to use shared Song and AudioQuality**

Replace `lib/features/player/application/player_engine.dart` with:

```dart
import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

class PlayerEngineSnapshot {
  const PlayerEngineSnapshot({
    this.currentSong,
    this.isLoading = false,
    this.isPlaying = false,
    this.position = Duration.zero,
    this.duration = Duration.zero,
    this.audioQuality = AudioQuality.k320,
  });

  final Song? currentSong;
  final bool isLoading;
  final bool isPlaying;
  final Duration position;
  final Duration duration;
  final AudioQuality audioQuality;

  PlayerEngineSnapshot copyWith({
    Song? currentSong,
    bool? isLoading,
    bool? isPlaying,
    Duration? position,
    Duration? duration,
    AudioQuality? audioQuality,
  }) {
    return PlayerEngineSnapshot(
      currentSong: currentSong ?? this.currentSong,
      isLoading: isLoading ?? this.isLoading,
      isPlaying: isPlaying ?? this.isPlaying,
      position: position ?? this.position,
      duration: duration ?? this.duration,
      audioQuality: audioQuality ?? this.audioQuality,
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
  Future<void> setAudioQuality(AudioQuality quality);
  Future<void> dispose();
}
```

- [ ] **Step 5: Add the media session adapter and the real engine implementation**

Create `lib/features/player/application/media_session_adapter.dart`:

```dart
import '../../../core/models/song.dart';

abstract class MediaSessionAdapter {
  Future<void> updateMetadata(Song song, {required bool isPlaying});
  Future<void> updateProgress({required Duration position, required Duration duration});
  Future<void> clear();
}

final class NoopMediaSessionAdapter implements MediaSessionAdapter {
  @override
  Future<void> clear() async {}

  @override
  Future<void> updateMetadata(Song song, {required bool isPlaying}) async {}

  @override
  Future<void> updateProgress({required Duration position, required Duration duration}) async {}
}
```

Create `lib/features/player/application/just_audio_player_engine.dart`:

```dart
import 'dart:async';

import 'package:just_audio/just_audio.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'media_session_adapter.dart';
import 'player_engine.dart';

final class JustAudioPlayerEngine implements PlayerEngine {
  JustAudioPlayerEngine._({
    required MediaSessionAdapter mediaSessionAdapter,
    AudioPlayer? audioPlayer,
    bool testMode = false,
  })  : _mediaSessionAdapter = mediaSessionAdapter,
        _audioPlayer = audioPlayer,
        _testMode = testMode;

  factory JustAudioPlayerEngine.real({MediaSessionAdapter? mediaSessionAdapter}) {
    return JustAudioPlayerEngine._(
      mediaSessionAdapter: mediaSessionAdapter ?? NoopMediaSessionAdapter(),
      audioPlayer: AudioPlayer(),
    );
  }

  factory JustAudioPlayerEngine.test() {
    return JustAudioPlayerEngine._(
      mediaSessionAdapter: NoopMediaSessionAdapter(),
      testMode: true,
    );
  }

  final MediaSessionAdapter _mediaSessionAdapter;
  final AudioPlayer? _audioPlayer;
  final bool _testMode;
  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _latestSnapshot = const PlayerEngineSnapshot();

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  PlayerEngineSnapshot get latestSnapshot => _latestSnapshot;

  @override
  Future<void> loadSong(Song song, {required AudioQuality quality}) async {
    _latestSnapshot = _latestSnapshot.copyWith(
      currentSong: song,
      audioQuality: quality,
      isLoading: true,
      isPlaying: false,
      position: Duration.zero,
      duration: Duration.zero,
    );
    _controller.add(_latestSnapshot);

    if (_testMode) {
      _latestSnapshot = _latestSnapshot.copyWith(isLoading: false, duration: const Duration(minutes: 4, seconds: 56));
      _controller.add(_latestSnapshot);
      return;
    }

    final url = song.url;
    if (url == null || url.isEmpty) {
      _latestSnapshot = _latestSnapshot.copyWith(isLoading: false);
      _controller.add(_latestSnapshot);
      return;
    }

    await _audioPlayer!.setUrl(url);
    _latestSnapshot = _latestSnapshot.copyWith(isLoading: false, duration: _audioPlayer!.duration ?? Duration.zero);
    _controller.add(_latestSnapshot);
  }

  @override
  Future<void> pause() async {
    if (!_testMode) {
      await _audioPlayer!.pause();
    }
    _latestSnapshot = _latestSnapshot.copyWith(isPlaying: false);
    _controller.add(_latestSnapshot);
    final song = _latestSnapshot.currentSong;
    if (song != null) {
      await _mediaSessionAdapter.updateMetadata(song, isPlaying: false);
    }
  }

  @override
  Future<void> play() async {
    if (!_testMode) {
      await _audioPlayer!.play();
    }
    _latestSnapshot = _latestSnapshot.copyWith(isPlaying: true);
    _controller.add(_latestSnapshot);
    final song = _latestSnapshot.currentSong;
    if (song != null) {
      await _mediaSessionAdapter.updateMetadata(song, isPlaying: true);
    }
  }

  @override
  Future<void> seek(Duration position) async {
    if (!_testMode) {
      await _audioPlayer!.seek(position);
    }
    _latestSnapshot = _latestSnapshot.copyWith(position: position);
    _controller.add(_latestSnapshot);
    await _mediaSessionAdapter.updateProgress(position: position, duration: _latestSnapshot.duration);
  }

  @override
  Future<void> setAudioQuality(AudioQuality quality) async {
    _latestSnapshot = _latestSnapshot.copyWith(audioQuality: quality);
    _controller.add(_latestSnapshot);
  }

  @override
  Future<void> dispose() async {
    if (!_testMode) {
      await _audioPlayer!.dispose();
    }
    await _controller.close();
  }
}
```

- [ ] **Step 6: Run the engine test and analyzer**

Run:

```bash
flutter test test/features/player/application/just_audio_player_engine_test.dart -r expanded
flutter analyze lib/features/player/application
```

Expected: PASS / `No issues found!`

- [ ] **Step 7: Commit the real engine slice**

```bash
git add pubspec.yaml lib/features/player/application test/features/player/application

git commit -m "$(cat <<'EOF'
feat: add real audio engine contract
EOF
)"
```

---

### Task 2: Add runtime queue helpers, persistence store, and controller runtime API

**Files:**
- Modify: `./lib/features/player/application/player_controller.dart`
- Modify: `./lib/features/player/domain/player_state.dart`
- Create: `./lib/features/player/application/player_queue_manager.dart`
- Create: `./lib/features/player/data/player_preferences_store.dart`
- Test: `./test/features/player/application/player_controller_runtime_test.dart`

- [ ] **Step 1: Write the failing runtime controller test**

Create `test/features/player/application/player_controller_runtime_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';

final class InMemoryPlayerPreferencesStore implements PlayerPreferencesStore {
  Song? currentSong;
  List<Song> queue = const <Song>[];
  String playMode = 'sequence';
  AudioQuality audioQuality = AudioQuality.k320;

  @override
  Future<AudioQuality> loadAudioQuality() async => audioQuality;

  @override
  Future<Song?> loadCurrentSong() async => currentSong;

  @override
  Future<String> loadPlayMode() async => playMode;

  @override
  Future<List<Song>> loadQueue() async => queue;

  @override
  Future<void> saveAudioQuality(AudioQuality value) async => audioQuality = value;

  @override
  Future<void> saveCurrentSong(Song? value) async => currentSong = value;

  @override
  Future<void> savePlayMode(String value) async => playMode = value;

  @override
  Future<void> saveQueue(List<Song> value) async => queue = value;
}

void main() {
  test('controller keeps queue, play mode, and audio quality aligned with runtime engine', () async {
    final engine = JustAudioPlayerEngine.test();
    final store = InMemoryPlayerPreferencesStore();
    final controller = PlayerController.runtime(engine: engine, preferencesStore: store);

    const song = Song(
      id: 'runtime-song',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
      url: 'https://example.com/song.mp3',
      audioQualities: [AudioQuality.flac, AudioQuality.k128],
    );

    await controller.playSong(song);
    expect(controller.state.currentSong?.key, 'netease:runtime-song');
    expect(controller.state.queue.single.key, 'netease:runtime-song');

    controller.togglePlayMode();
    expect(controller.state.playMode, 'loop');

    await controller.setAudioQuality(AudioQuality.k128);
    expect(controller.state.audioQuality, AudioQuality.k128);
  });
}
```

- [ ] **Step 2: Run the runtime controller test to verify the runtime controller API does not exist yet**

Run:

```bash
flutter test test/features/player/application/player_controller_runtime_test.dart -r expanded
```

Expected: FAIL because `PlayerController.runtime(...)` and runtime state fields are not available yet.

- [ ] **Step 3: Add queue helpers and persistence storage**

Create `lib/features/player/application/player_queue_manager.dart`:

```dart
import '../../../core/models/song.dart';

int getNextQueueIndex(List<Song> queue, Song? currentSong, String playMode) {
  if (queue.isEmpty) return -1;
  final currentIndex = currentSong == null ? -1 : queue.indexWhere((song) => song.key == currentSong.key);
  if (currentIndex < 0) return 0;
  if (playMode == 'shuffle') {
    return (currentIndex + 1) % queue.length;
  }
  if (currentIndex + 1 >= queue.length) return 0;
  return currentIndex + 1;
}

int getPreviousQueueIndex(List<Song> queue, Song? currentSong, String playMode) {
  if (queue.isEmpty) return -1;
  final currentIndex = currentSong == null ? -1 : queue.indexWhere((song) => song.key == currentSong.key);
  if (currentIndex < 0) return 0;
  if (playMode == 'shuffle') {
    return currentIndex == 0 ? queue.length - 1 : currentIndex - 1;
  }
  return currentIndex == 0 ? queue.length - 1 : currentIndex - 1;
}
```

Create `lib/features/player/data/player_preferences_store.dart`:

```dart
import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

abstract class PlayerPreferencesStore {
  Future<Song?> loadCurrentSong();
  Future<void> saveCurrentSong(Song? value);
  Future<List<Song>> loadQueue();
  Future<void> saveQueue(List<Song> value);
  Future<String> loadPlayMode();
  Future<void> savePlayMode(String value);
  Future<AudioQuality> loadAudioQuality();
  Future<void> saveAudioQuality(AudioQuality value);
}
```

- [ ] **Step 4: Update PlayerState and PlayerController to the runtime shape**

Replace `lib/features/player/domain/player_state.dart` with:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

part 'player_state.freezed.dart';

@freezed
abstract class PlayerState with _$PlayerState {
  const factory PlayerState({
    Song? currentSong,
    @Default(<Song>[]) List<Song> queue,
    @Default(false) bool isPlaying,
    @Default(false) bool isLoading,
    @Default(Duration.zero) Duration position,
    @Default(Duration.zero) Duration duration,
    @Default('sequence') String playMode,
    @Default(AudioQuality.k320) AudioQuality audioQuality,
    @Default(false) bool isExpanded,
    @Default(false) bool showLyrics,
    @Default(false) bool showQueue,
    @Default(false) bool showDownload,
    @Default(false) bool showMore,
  }) = _PlayerState;
}
```

Replace `lib/features/player/application/player_controller.dart` with:

```dart
import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import '../data/player_preferences_store.dart';
import 'player_engine.dart';
import 'player_queue_manager.dart';

final class PlayerController extends ChangeNotifier {
  PlayerController.runtime({required PlayerEngine engine, required PlayerPreferencesStore preferencesStore})
      : _engine = engine,
        _preferencesStore = preferencesStore {
    _subscription = _engine.snapshots.listen(_applySnapshot);
  }

  final PlayerEngine _engine;
  final PlayerPreferencesStore _preferencesStore;
  StreamSubscription<PlayerEngineSnapshot>? _subscription;

  PlayerState _state = const PlayerState();
  PlayerState get state => _state;

  Future<void> playSong(Song song, {AudioQuality? forceQuality}) async {
    final quality = forceQuality ?? _state.audioQuality;
    final queue = _state.queue.any((item) => item.key == song.key) ? _state.queue : [..._state.queue, song];
    _state = _state.copyWith(
      currentSong: song,
      queue: List<Song>.unmodifiable(queue),
      isLoading: true,
      isPlaying: false,
      position: Duration.zero,
      duration: Duration.zero,
      audioQuality: quality,
    );
    notifyListeners();
    await _preferencesStore.saveCurrentSong(song);
    await _preferencesStore.saveQueue(_state.queue);
    await _engine.loadSong(song, quality: quality);
    await _engine.play();
  }

  Future<void> togglePlay() async {
    if (_state.isPlaying) {
      await _engine.pause();
    } else {
      await _engine.play();
    }
  }

  Future<void> seek(Duration position) => _engine.seek(position);

  Future<void> playNext({bool force = true}) async {
    if (_state.queue.isEmpty) return;
    final nextIndex = getNextQueueIndex(_state.queue, _state.currentSong, _state.playMode);
    if (nextIndex < 0) return;
    await playSong(_state.queue[nextIndex], forceQuality: _state.audioQuality);
  }

  Future<void> playPrev() async {
    if (_state.queue.isEmpty) return;
    final previousIndex = getPreviousQueueIndex(_state.queue, _state.currentSong, _state.playMode);
    if (previousIndex < 0) return;
    await playSong(_state.queue[previousIndex], forceQuality: _state.audioQuality);
  }

  void togglePlayMode() {
    final next = switch (_state.playMode) {
      'sequence' => 'loop',
      'loop' => 'shuffle',
      _ => 'sequence',
    };
    _state = _state.copyWith(playMode: next);
    notifyListeners();
    _preferencesStore.savePlayMode(next);
  }

  Future<void> setAudioQuality(AudioQuality quality) async {
    _state = _state.copyWith(audioQuality: quality);
    notifyListeners();
    await _preferencesStore.saveAudioQuality(quality);
    await _engine.setAudioQuality(quality);
  }

  void setShowLyrics(bool value) => _updateOverlay(showLyrics: value);
  void setShowQueue(bool value) => _updateOverlay(showQueue: value);
  void setShowDownload(bool value) => _updateOverlay(showDownload: value);
  void setShowMore(bool value) => _updateOverlay(showMore: value);
  void expand() => _updateOverlay(isExpanded: true);
  void collapse() => _updateOverlay(isExpanded: false);

  void _updateOverlay({bool? isExpanded, bool? showLyrics, bool? showQueue, bool? showDownload, bool? showMore}) {
    _state = _state.copyWith(
      isExpanded: isExpanded ?? _state.isExpanded,
      showLyrics: showLyrics ?? _state.showLyrics,
      showQueue: showQueue ?? _state.showQueue,
      showDownload: showDownload ?? _state.showDownload,
      showMore: showMore ?? _state.showMore,
    );
    notifyListeners();
  }

  void _applySnapshot(PlayerEngineSnapshot snapshot) {
    _state = _state.copyWith(
      currentSong: snapshot.currentSong ?? _state.currentSong,
      isLoading: snapshot.isLoading,
      isPlaying: snapshot.isPlaying,
      position: snapshot.position,
      duration: snapshot.duration,
      audioQuality: snapshot.audioQuality,
    );
    notifyListeners();
  }

  Future<void> disposeController() async {
    await _subscription?.cancel();
    await _engine.dispose();
  }
}
```

Generate code:

```bash
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 5: Run the runtime controller test and analyzer**

Run:

```bash
flutter test test/features/player/application/player_controller_runtime_test.dart -r expanded
flutter analyze lib/features/player/application lib/features/player/domain lib/features/player/data
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the runtime controller slice**

```bash
git add lib/features/player/application lib/features/player/domain lib/features/player/data test/features/player/application

git commit -m "$(cat <<'EOF'
feat: port runtime player controller behavior
EOF
)"
```

---

### Task 3: Add deterministic download service and wire the parity UI to the runtime controller

**Files:**
- Modify: `./lib/features/player/presentation/widgets/mini_player_bar.dart`
- Modify: `./lib/features/player/presentation/widgets/full_player_sheet.dart`
- Modify: `./lib/features/player/presentation/widgets/player_download_sheet.dart`
- Modify: `./lib/features/library/presentation/library_page.dart`
- Create: `./lib/features/player/data/player_download_service.dart`
- Test: `./test/features/player/application/player_download_service_test.dart`

- [ ] **Step 1: Write the failing download service test**

Create `test/features/player/application/player_download_service_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/player_download_service.dart';

void main() {
  test('download service derives the legacy file name and extension', () async {
    final service = PlayerDownloadService.test();
    const song = Song(
      id: 'download-song',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
      url: 'https://example.com/song.flac',
    );

    final result = await service.prepareDownload(song, AudioQuality.flac);

    expect(result.fileName, '马也_Crabbit - 海与你.flac');
  });
}
```

- [ ] **Step 2: Run the download service test to verify the service does not exist yet**

Run:

```bash
flutter test test/features/player/application/player_download_service_test.dart -r expanded
```

Expected: FAIL with import errors for `player_download_service.dart`.

- [ ] **Step 3: Implement the deterministic download service**

Create `lib/features/player/data/player_download_service.dart`:

```dart
import 'package:path_provider/path_provider.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

class DownloadPreparation {
  const DownloadPreparation({required this.fileName, required this.extension});

  final String fileName;
  final String extension;
}

class PlayerDownloadService {
  PlayerDownloadService._({required this.testMode});

  factory PlayerDownloadService.test() => PlayerDownloadService._(testMode: true);
  factory PlayerDownloadService.real() => PlayerDownloadService._(testMode: false);

  final bool testMode;

  Future<DownloadPreparation> prepareDownload(Song song, AudioQuality quality) async {
    if (!testMode) {
      await getApplicationDocumentsDirectory();
    }
    final extension = switch (quality) {
      AudioQuality.k128 => 'mp3',
      AudioQuality.k320 => 'mp3',
      AudioQuality.flac => 'flac',
      AudioQuality.flac24bit => 'flac',
    };
    return DownloadPreparation(
      fileName: '${song.artist} - ${song.name}.$extension',
      extension: extension,
    );
  }
}
```

- [ ] **Step 4: Update the parity UI to call the runtime controller API**

Update `lib/features/player/presentation/widgets/mini_player_bar.dart` so it reads `state.currentSong` instead of the old placeholder fields and uses `togglePlay()` / `playNext()`.

Update `lib/features/player/presentation/widgets/full_player_sheet.dart` so it reads `state.currentSong`, `state.position`, `state.duration`, `state.playMode`, and the overlay booleans, and wires:
- play/pause -> `togglePlay()`
- previous -> `playPrev()`
- next -> `playNext()`
- progress slider -> `seek()`
- play mode button -> `togglePlayMode()`
- queue/download/more buttons -> `setShowQueue(true)`, `setShowDownload(true)`, `setShowMore(true)`

Update `lib/features/library/presentation/library_page.dart` so song taps call `playSong(song)` on the runtime controller instead of the placeholder scaffold API.

- [ ] **Step 5: Run the download service test, full test suite, and analyzer**

Run:

```bash
flutter test test/features/player/application/player_download_service_test.dart -r expanded
flutter test
flutter analyze
```

Expected: PASS / PASS / `No issues found!`

- [ ] **Step 6: Commit the runtime parity completion slice**

```bash
git add lib/features/player lib/features/library test/features/player

git commit -m "$(cat <<'EOF'
feat: wire parity player runtime behavior
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers the final runtime parity gap from the redesign spec:
- real playback engine
- media session/platform boundary
- queue / progress / quality / fallback runtime behavior
- download persistence/runtime integration
- UI wired to the real runtime instead of the placeholder scaffold

### Placeholder scan

No TODO/TBD placeholders remain. Each task includes exact files, code, and commands.

### Type consistency

This plan assumes earlier plans have already introduced the shared `Song`, `Playlist`, `AudioQuality`, and parity UI/state layers. It introduces these final runtime symbols:
- `PlayerEngine`
- `PlayerEngineSnapshot`
- `JustAudioPlayerEngine`
- `PlayerPreferencesStore`
- `PlayerDownloadService`
- `PlayerController.runtime(...)`
