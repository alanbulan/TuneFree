# Download Management and Offline Playback Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current single-track download foundation into a manageable download system, automatically prefer valid local downloaded files during playback, and replace the default Flutter app icons with the source project branding.

**Architecture:** This plan extends the download stores to support listing, cleanup, and deletion; adds a dedicated download-library repository plus a local playback resolver; and integrates a local-first decision path into `PlayerController` before falling back to the existing online resolution flow. The Library area becomes the user-facing management surface for downloaded tracks, while app icon parity is handled as a bounded asset/configuration slice at the end.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, shared_preferences, path_provider, just_audio, flutter_test

---

## Scope Check

This plan covers one coherent subsystem: download management plus offline-priority playback closure, with source app icon parity folded in as a bounded branding task. It intentionally does **not** cover batch downloads, playlist downloads, background download recovery, public Downloads directory integration, or a global offline-only mode.

## File Structure

- Modify: `lib/features/player/data/download_record_store.dart`
- Modify: `lib/features/player/data/download_file_store.dart`
- Create: `lib/features/player/data/download_library_repository.dart`
- Create: `lib/features/player/data/local_playback_resolver.dart`
- Modify: `lib/features/player/application/player_controller.dart`
- Modify: `lib/features/library/application/library_state.dart`
- Modify: `lib/features/library/application/library_controller.dart`
- Modify: `lib/features/library/presentation/library_page.dart`
- Create: `lib/features/library/presentation/widgets/downloads_management_section.dart`
- Test: `test/features/player/data/download_record_store_test.dart`
- Test: `test/features/player/data/download_file_store_test.dart`
- Create: `test/features/player/data/download_library_repository_test.dart`
- Create: `test/features/player/data/local_playback_resolver_test.dart`
- Modify: `test/features/player/application/player_controller_test.dart`
- Modify: `test/features/library/presentation/library_page_golden_test.dart`
- Modify: `android/app/src/main/res/mipmap-hdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-mdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
- Modify: `ios/Runner/Assets.xcassets/AppIcon.appiconset/*`
- Modify: `web/icons/Icon-192.png`
- Modify: `web/icons/Icon-512.png`
- Modify: `web/icons/Icon-maskable-192.png`
- Modify: `web/icons/Icon-maskable-512.png`

Responsibility split:

- `download_record_store.dart` becomes the low-level record persistence/query boundary.
- `download_file_store.dart` becomes the low-level file query/delete boundary.
- `download_library_repository.dart` owns management-list assembly, sorting, filtering, and delete orchestration.
- `local_playback_resolver.dart` owns exact-quality local-hit detection for playback.
- `player_controller.dart` remains the business orchestrator but depends on the local playback resolver instead of raw file-system checks.
- `downloads_management_section.dart` is the Library-side UI surface for downloaded tracks.

---

### Task 1: Extend download stores for listing, cleanup, and deletion

**Files:**
- Modify: `lib/features/player/data/download_record_store.dart`
- Modify: `lib/features/player/data/download_file_store.dart`
- Modify: `test/features/player/data/download_record_store_test.dart`
- Modify: `test/features/player/data/download_file_store_test.dart`

- [ ] **Step 1: Add the failing record-store test for list/remove and malformed data recovery**

Append this test to `test/features/player/data/download_record_store_test.dart`:

```dart
test('record store lists all records, removes records, and recovers from malformed storage', () async {
  SharedPreferences.setMockInitialValues(<String, Object>{
    'player_download_records_v1': 'not-json',
  });
  final store = SharedPreferencesDownloadRecordStore.test(
    fileExists: (_) async => true,
  );

  final malformedList = await store.listAll();
  expect(malformedList, isEmpty);

  const flacRecord = DownloadRecord(
    songKey: 'netease:123456',
    songId: '123456',
    songName: '海与你',
    artist: '马也_Crabbit',
    quality: 'flac',
    filePath: '/downloads/song.flac',
    fileName: 'song.flac',
    downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
  );
  const mp3Record = DownloadRecord(
    songKey: 'netease:123456',
    songId: '123456',
    songName: '海与你',
    artist: '马也_Crabbit',
    quality: '320k',
    filePath: '/downloads/song.mp3',
    fileName: 'song.mp3',
    downloadedAtIso8601: '2026-04-17T10:00:01.000Z',
  );

  await store.save(flacRecord);
  await store.save(mp3Record);

  final listed = await store.listAll();
  expect(listed.map((record) => record.quality), <String>['flac', '320k']);

  await store.remove(songKey: 'netease:123456', quality: '320k');
  final afterRemove = await store.listAll();
  expect(afterRemove.map((record) => record.quality), <String>['flac']);
});
```

- [ ] **Step 2: Add the failing file-store test for deleting and file metadata checks**

Append this test to `test/features/player/data/download_file_store_test.dart`:

```dart
test('file store deletes final files and reports file existence', () async {
  final fileStore = DownloadFileStore.test(
    rootDirectory: await Directory.systemTemp.createTemp('tf-downloads-delete-'),
  );
  addTearDown(() async {
    await fileStore.deleteTestRoot();
  });

  const song = Song(
    id: 'delete-song',
    name: '删除测试',
    artist: 'TuneFree',
    source: MusicSource.netease,
  );

  final target = await fileStore.createTarget(song: song, quality: AudioQuality.flac);
  await target.finalFile.create(recursive: true);
  await target.finalFile.writeAsString('bytes');

  expect(await fileStore.fileExists(target.finalFile.path), isTrue);
  await fileStore.deleteFinalFile(target.finalFile.path);
  expect(await fileStore.fileExists(target.finalFile.path), isFalse);
});
```

- [ ] **Step 3: Run the store tests to verify the new APIs do not exist yet**

Run:

```bash
flutter test test/features/player/data/download_record_store_test.dart -r expanded
flutter test test/features/player/data/download_file_store_test.dart -r expanded
```

Expected: FAIL with missing `listAll()` / `deleteFinalFile()` / malformed-data recovery behavior.

- [ ] **Step 4: Extend the record store for listing and stronger recovery**

Update `lib/features/player/data/download_record_store.dart`:

```dart
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'download_record.dart';

typedef DownloadFileExists = Future<bool> Function(String path);

abstract class DownloadRecordStore {
  Future<DownloadRecord?> load({required String songKey, required String quality});
  Future<List<DownloadRecord>> listAll();
  Future<List<DownloadRecord>> listBySongKey(String songKey);
  Future<void> save(DownloadRecord record);
  Future<void> remove({required String songKey, required String quality});
}

class SharedPreferencesDownloadRecordStore implements DownloadRecordStore {
  const SharedPreferencesDownloadRecordStore._({required this.fileExists});

  factory SharedPreferencesDownloadRecordStore.real({required DownloadFileExists fileExists}) {
    return SharedPreferencesDownloadRecordStore._(fileExists: fileExists);
  }

  factory SharedPreferencesDownloadRecordStore.test({required DownloadFileExists fileExists}) {
    return SharedPreferencesDownloadRecordStore._(fileExists: fileExists);
  }

  static const String _storageKey = 'player_download_records_v1';

  final DownloadFileExists fileExists;

  @override
  Future<DownloadRecord?> load({required String songKey, required String quality}) async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    final recordKey = _recordKey(songKey, quality);
    final json = records[recordKey];
    if (json is! Map<String, dynamic>) {
      return null;
    }

    final record = DownloadRecord.fromJson(json);
    if (_isInvalidRecord(record) || !await fileExists(record.filePath)) {
      records.remove(recordKey);
      await _persistRecordMap(preferences, records);
      return null;
    }

    return record;
  }

  @override
  Future<List<DownloadRecord>> listAll() async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    final entries = <DownloadRecord>[];
    var changed = false;

    for (final entry in records.entries.toList(growable: false)) {
      final json = entry.value;
      if (json is! Map<String, dynamic>) {
        records.remove(entry.key);
        changed = true;
        continue;
      }
      final record = DownloadRecord.fromJson(json);
      if (_isInvalidRecord(record) || !await fileExists(record.filePath)) {
        records.remove(entry.key);
        changed = true;
        continue;
      }
      entries.add(record);
    }

    if (changed) {
      await _persistRecordMap(preferences, records);
    }

    entries.sort((a, b) => b.downloadedAtIso8601.compareTo(a.downloadedAtIso8601));
    return entries;
  }

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async {
    final records = await listAll();
    return records.where((record) => record.songKey == songKey).toList(growable: false);
  }

  @override
  Future<void> save(DownloadRecord record) async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    records[_recordKey(record.songKey, record.quality)] = record.toJson();
    await _persistRecordMap(preferences, records);
  }

  @override
  Future<void> remove({required String songKey, required String quality}) async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    records.remove(_recordKey(songKey, quality));
    await _persistRecordMap(preferences, records);
  }

  Future<Map<String, dynamic>> _loadRecordMap(SharedPreferences preferences) async {
    final rawValue = preferences.getString(_storageKey);
    if (rawValue == null || rawValue.isEmpty) {
      return <String, dynamic>{};
    }
    try {
      final decoded = jsonDecode(rawValue);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
    } catch (error) {
      debugPrint('SharedPreferencesDownloadRecordStore decode failed: $error');
    }
    await preferences.remove(_storageKey);
    return <String, dynamic>{};
  }

  Future<void> _persistRecordMap(
    SharedPreferences preferences,
    Map<String, dynamic> records,
  ) {
    return preferences.setString(_storageKey, jsonEncode(records));
  }

  bool _isInvalidRecord(DownloadRecord record) {
    return record.songKey.isEmpty ||
        record.songId.isEmpty ||
        record.filePath.isEmpty ||
        record.quality.isEmpty ||
        record.downloadedAtIso8601.isEmpty;
  }

  String _recordKey(String songKey, String quality) => '$songKey::$quality';
}
```

- [ ] **Step 5: Extend the file store for delete support**

Update `lib/features/player/data/download_file_store.dart` with this new method:

```dart
Future<void> deleteFinalFile(String path) async {
  final file = File(path);
  if (await file.exists()) {
    await file.delete();
  }
}
```

- [ ] **Step 6: Run the store tests and analyzer**

Run:

```bash
flutter test test/features/player/data/download_record_store_test.dart -r expanded
flutter test test/features/player/data/download_file_store_test.dart -r expanded
flutter analyze lib/features/player/data/download_record_store.dart lib/features/player/data/download_file_store.dart test/features/player/data/download_record_store_test.dart test/features/player/data/download_file_store_test.dart
```

Expected: PASS / PASS / `No issues found!`

- [ ] **Step 7: Commit the store expansion slice**

```bash
git add lib/features/player/data/download_record_store.dart lib/features/player/data/download_file_store.dart test/features/player/data/download_record_store_test.dart test/features/player/data/download_file_store_test.dart

git commit -m "$(cat <<'EOF'
feat: expand download storage management
EOF
)"
```

---

### Task 2: Add the download library repository and management state

**Files:**
- Create: `lib/features/player/data/download_library_repository.dart`
- Modify: `lib/features/library/application/library_state.dart`
- Modify: `lib/features/library/application/library_controller.dart`
- Create: `test/features/player/data/download_library_repository_test.dart`

- [ ] **Step 1: Write the failing repository test**

Create `test/features/player/data/download_library_repository_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';
import 'package:tunefree/features/player/data/download_file_store.dart';

final class InMemoryDownloadRecordStore implements DownloadRecordStore {
  final List<DownloadRecord> records;

  InMemoryDownloadRecordStore(this.records);

  @override
  Future<DownloadRecord?> load({required String songKey, required String quality}) async {
    for (final record in records) {
      if (record.songKey == songKey && record.quality == quality) {
        return record;
      }
    }
    return null;
  }

  @override
  Future<List<DownloadRecord>> listAll() async => List<DownloadRecord>.from(records);

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async =>
      records.where((record) => record.songKey == songKey).toList(growable: false);

  @override
  Future<void> save(DownloadRecord record) async {}

  @override
  Future<void> remove({required String songKey, required String quality}) async {
    records.removeWhere((record) => record.songKey == songKey && record.quality == quality);
  }
}

final class StubDownloadFileStore extends DownloadFileStore {
  StubDownloadFileStore() : super.test(rootDirectory: throw UnimplementedError());
}
```

Then add the actual test body below it:

```dart
void main() {
  test('download library repository lists downloads sorted by time and deletes records/files together', () async {
    final removedPaths = <String>[];
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      const DownloadRecord(
        songKey: 'netease:1',
        songId: '1',
        songName: '较早下载',
        artist: '歌手甲',
        quality: '320k',
        filePath: '/downloads/1.mp3',
        fileName: '1.mp3',
        downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
      ),
      const DownloadRecord(
        songKey: 'netease:2',
        songId: '2',
        songName: '较新下载',
        artist: '歌手乙',
        quality: 'flac',
        filePath: '/downloads/2.flac',
        fileName: '2.flac',
        downloadedAtIso8601: '2026-04-17T10:01:00.000Z',
      ),
    ]);
    final repository = DownloadLibraryRepository(
      recordStore: recordStore,
      fileExists: (path) async => true,
      deleteFile: (path) async {
        removedPaths.add(path);
      },
    );

    final items = await repository.listDownloads();
    expect(items.map((item) => item.songName), <String>['较新下载', '较早下载']);

    await repository.deleteDownload(songKey: 'netease:2', quality: 'flac', filePath: '/downloads/2.flac');

    expect(removedPaths, <String>['/downloads/2.flac']);
    expect(recordStore.records.map((record) => record.songKey), <String>['netease:1']);
  });
}
```

- [ ] **Step 2: Run the repository test to verify the repository/state APIs do not exist yet**

Run:

```bash
flutter test test/features/player/data/download_library_repository_test.dart -r expanded
```

Expected: FAIL with missing `download_library_repository.dart` and library state/controller fields.

- [ ] **Step 3: Create the download library repository**

Create `lib/features/player/data/download_library_repository.dart`:

```dart
import 'download_record_store.dart';

class DownloadedTrackItem {
  const DownloadedTrackItem({
    required this.songKey,
    required this.songName,
    required this.artist,
    required this.quality,
    required this.fileName,
    required this.filePath,
    required this.downloadedAt,
    required this.exists,
  });

  final String songKey;
  final String songName;
  final String artist;
  final String quality;
  final String fileName;
  final String filePath;
  final DateTime downloadedAt;
  final bool exists;
}

class DownloadLibraryRepository {
  const DownloadLibraryRepository({
    required DownloadRecordStore recordStore,
    required Future<bool> Function(String path) fileExists,
    required Future<void> Function(String path) deleteFile,
  })  : _recordStore = recordStore,
        _fileExists = fileExists,
        _deleteFile = deleteFile;

  final DownloadRecordStore _recordStore;
  final Future<bool> Function(String path) _fileExists;
  final Future<void> Function(String path) _deleteFile;

  Future<List<DownloadedTrackItem>> listDownloads() async {
    final records = await _recordStore.listAll();
    final items = <DownloadedTrackItem>[];
    for (final record in records) {
      items.add(
        DownloadedTrackItem(
          songKey: record.songKey,
          songName: record.songName,
          artist: record.artist,
          quality: record.quality,
          fileName: record.fileName,
          filePath: record.filePath,
          downloadedAt: DateTime.parse(record.downloadedAtIso8601),
          exists: await _fileExists(record.filePath),
        ),
      );
    }
    items.sort((a, b) => b.downloadedAt.compareTo(a.downloadedAt));
    return items;
  }

  Future<void> deleteDownload({
    required String songKey,
    required String quality,
    required String filePath,
  }) async {
    await _deleteFile(filePath);
    await _recordStore.remove(songKey: songKey, quality: quality);
  }
}
```

- [ ] **Step 4: Extend library state and controller with download-management state**

Update `lib/features/library/application/library_state.dart`:

```dart
import '../../player/data/download_library_repository.dart';
```

Add fields to the freezed factory:

```dart
    @Default(<DownloadedTrackItem>[]) List<DownloadedTrackItem> downloads,
    @Default('all') String downloadFilter,
```

Update `lib/features/library/application/library_controller.dart` to inject and load the download repository.

At the top add:

```dart
import '../../player/data/download_file_store.dart';
import '../../player/data/download_library_repository.dart';
import '../../player/data/download_record_store.dart';
```

Add providers before `libraryControllerProvider`:

```dart
final downloadLibraryRepositoryProvider = Provider<DownloadLibraryRepository>((ref) {
  final fileStore = ref.watch(downloadFileStoreProvider);
  final recordStore = ref.watch(downloadRecordStoreProvider);
  return DownloadLibraryRepository(
    recordStore: recordStore,
    fileExists: fileStore.fileExists,
    deleteFile: fileStore.deleteFinalFile,
  );
});
```

Update the provider to pass the repository:

```dart
final libraryControllerProvider = ChangeNotifierProvider<LibraryController>((ref) {
  final controller = LibraryController(
    storage: ref.watch(libraryStorageProvider),
    downloadLibraryRepository: ref.watch(downloadLibraryRepositoryProvider),
  );
  controller.load();
  return controller;
});
```

Update constructor and field:

```dart
final class LibraryController extends ChangeNotifier {
  LibraryController({
    required LibraryStorage storage,
    required DownloadLibraryRepository downloadLibraryRepository,
  })  : _storage = storage,
        _downloadLibraryRepository = downloadLibraryRepository;

  final LibraryStorage _storage;
  final DownloadLibraryRepository _downloadLibraryRepository;
```

In `load()` add:

```dart
      downloads: await _downloadLibraryRepository.listDownloads(),
```

Add these methods:

```dart
  void setDownloadFilter(String value) {
    _state = _state.copyWith(downloadFilter: value);
    notifyListeners();
  }

  Future<void> refreshDownloads() async {
    _state = _state.copyWith(
      downloads: await _downloadLibraryRepository.listDownloads(),
    );
    notifyListeners();
  }

  Future<void> deleteDownload(DownloadedTrackItem item) async {
    await _downloadLibraryRepository.deleteDownload(
      songKey: item.songKey,
      quality: item.quality,
      filePath: item.filePath,
    );
    await refreshDownloads();
  }
```

- [ ] **Step 5: Run the repository test and analyze the state/controller slice**

Run:

```bash
flutter test test/features/player/data/download_library_repository_test.dart -r expanded
flutter analyze lib/features/player/data/download_library_repository.dart lib/features/library/application/library_state.dart lib/features/library/application/library_controller.dart test/features/player/data/download_library_repository_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the download management state slice**

```bash
git add lib/features/player/data/download_library_repository.dart lib/features/library/application/library_state.dart lib/features/library/application/library_controller.dart test/features/player/data/download_library_repository_test.dart

git commit -m "$(cat <<'EOF'
feat: add download management state
EOF
)"
```

---

### Task 3: Add the local playback resolver and local-first playback path

**Files:**
- Create: `lib/features/player/data/local_playback_resolver.dart`
- Modify: `lib/features/player/application/player_controller.dart`
- Create: `test/features/player/data/local_playback_resolver_test.dart`
- Modify: `test/features/player/application/player_controller_test.dart`

- [ ] **Step 1: Write the failing local resolver test**

Create `test/features/player/data/local_playback_resolver_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';

void main() {
  test('local playback resolver returns an exact-quality local hit only', () async {
    final resolver = LocalPlaybackResolver(
      recordsForSong: (songKey) async => <DownloadRecord>[
        const DownloadRecord(
          songKey: 'netease:download-song',
          songId: 'download-song',
          songName: '海与你',
          artist: '马也_Crabbit',
          quality: 'flac',
          filePath: '/downloads/song.flac',
          fileName: 'song.flac',
          downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
        ),
      ],
      fileExists: (path) async => path == '/downloads/song.flac',
      removeRecord: ({required songKey, required quality}) async {},
    );

    const song = Song(
      id: 'download-song',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    final flacHit = await resolver.resolve(song, AudioQuality.flac);
    expect(flacHit?.filePath, '/downloads/song.flac');

    final mp3Miss = await resolver.resolve(song, AudioQuality.k320);
    expect(mp3Miss, isNull);
  });
}
```

- [ ] **Step 2: Run the local resolver test to verify the resolver does not exist yet**

Run:

```bash
flutter test test/features/player/data/local_playback_resolver_test.dart -r expanded
```

Expected: FAIL with missing `local_playback_resolver.dart`.

- [ ] **Step 3: Create the local playback resolver**

Create `lib/features/player/data/local_playback_resolver.dart`:

```dart
import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'download_record.dart';

class LocalPlaybackMatch {
  const LocalPlaybackMatch({
    required this.song,
    required this.filePath,
  });

  final Song song;
  final String filePath;
}

class LocalPlaybackResolver {
  const LocalPlaybackResolver({
    required Future<List<DownloadRecord>> Function(String songKey) recordsForSong,
    required Future<bool> Function(String path) fileExists,
    required Future<void> Function({required String songKey, required String quality}) removeRecord,
  })  : _recordsForSong = recordsForSong,
        _fileExists = fileExists,
        _removeRecord = removeRecord;

  final Future<List<DownloadRecord>> Function(String songKey) _recordsForSong;
  final Future<bool> Function(String path) _fileExists;
  final Future<void> Function({required String songKey, required String quality}) _removeRecord;

  Future<LocalPlaybackMatch?> resolve(Song song, AudioQuality quality) async {
    final records = await _recordsForSong(song.key);
    for (final record in records) {
      if (record.quality != quality.wireValue) {
        continue;
      }
      if (!await _fileExists(record.filePath)) {
        await _removeRecord(songKey: record.songKey, quality: record.quality);
        return null;
      }
      return LocalPlaybackMatch(
        song: song.copyWith(url: 'file://${record.filePath}'),
        filePath: record.filePath,
      );
    }
    return null;
  }
}
```

- [ ] **Step 4: Integrate local-first playback into the player controller**

Update `lib/features/player/application/player_controller.dart`.

Add this import:

```dart
import '../data/local_playback_resolver.dart';
```

Add provider:

```dart
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
```

Update `PlayerController.runtime(...)` and `initializeRuntime(...)` to accept optional `LocalPlaybackResolver localPlaybackResolver`.

Add field in the mixin:

```dart
  LocalPlaybackResolver? _localPlaybackResolver;
```

Pass it in runtime/notifier initialization:

```dart
      localPlaybackResolver: ref.read(localPlaybackResolverProvider),
```

and

```dart
      localPlaybackResolver: localPlaybackResolver,
```

Update `initializeRuntime(...)` signature and body:

```dart
    LocalPlaybackResolver? localPlaybackResolver,
```

```dart
    _localPlaybackResolver = localPlaybackResolver;
```

In `_openSong(...)`, right after `final attemptedResolution = _canResolveSong(song);`, insert:

```dart
      final localMatch = await _resolveLocalPlaybackIfAvailable(song, quality);
      if (localMatch != null) {
        final localSong = localMatch.song;
        final localQueue = List<Song>.unmodifiable(
          nextQueue
              .map((item) => item.key == localSong.key ? localSong : item)
              .toList(growable: false),
        );
        state = state.copyWith(currentSong: localSong, queue: localQueue);
        await _preferencesStore.saveCurrentSong(localSong);
        await _preferencesStore.saveQueue(localQueue);
        await _preferencesStore.saveAudioQuality(quality);
        await _engine.loadSong(localSong, quality: quality);
        if (autoPlay) {
          await _engine.play();
        }
        return;
      }
```

Add helper:

```dart
  Future<LocalPlaybackMatch?> _resolveLocalPlaybackIfAvailable(
    Song song,
    AudioQuality quality,
  ) {
    final resolver = _localPlaybackResolver;
    if (resolver == null) {
      return Future<LocalPlaybackMatch?>.value(null);
    }
    return resolver.resolve(song, quality);
  }
```

- [ ] **Step 5: Add controller regression coverage for local-first playback**

Append this test to `test/features/player/application/player_controller_test.dart`:

```dart
test('playSong prefers exact-quality local files before resolving remotely', () async {
  final fakeEngine = FakePlayerEngine();
  final localSong = const Song(
    id: 'current-track',
    name: 'Current Track',
    artist: 'TuneFree',
    source: MusicSource.netease,
    url: 'file:///downloads/current-track.flac',
  );
  final container = ProviderContainer(
    overrides: [
      playerEngineProvider.overrideWithValue(fakeEngine),
      mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
      playerPreferencesStoreProvider.overrideWithValue(TestPlayerPreferencesStore()),
      localPlaybackResolverProvider.overrideWithValue(
        LocalPlaybackResolver(
          recordsForSong: (songKey) async => <DownloadRecord>[
            const DownloadRecord(
              songKey: 'netease:current-track',
              songId: 'current-track',
              songName: 'Current Track',
              artist: 'TuneFree',
              quality: '320k',
              filePath: '/downloads/current-track.flac',
              fileName: 'current-track.flac',
              downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
            ),
          ],
          fileExists: (path) async => true,
          removeRecord: ({required songKey, required quality}) async {},
        ),
      ),
      songResolutionRepositoryProvider.overrideWithValue(
        SongResolutionRepository.test(
          resolveSongValue: (song, quality) async => throw StateError('remote resolve should not run'),
        ),
      ),
    ],
  );
  addTearDown(container.dispose);

  const track = PlayerTrack(
    id: 'current-track',
    source: 'netease',
    title: 'Current Track',
    artist: 'TuneFree',
  );

  final controller = container.read(playerControllerProvider.notifier);
  await controller.openTrack(track, queue: const [track]);
  await Future<void>.delayed(Duration.zero);

  expect(fakeEngine.latestSnapshot.currentSong?.url, 'file:///downloads/current-track.flac');
});
```

Add these imports at the top if missing:

```dart
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';
```

- [ ] **Step 6: Run the local playback tests and analyzer**

Run:

```bash
flutter test test/features/player/data/local_playback_resolver_test.dart -r expanded
flutter test test/features/player/application/player_controller_test.dart -r expanded
flutter analyze lib/features/player/data/local_playback_resolver.dart lib/features/player/application/player_controller.dart test/features/player/data/local_playback_resolver_test.dart test/features/player/application/player_controller_test.dart
```

Expected: PASS / PASS / `No issues found!`

- [ ] **Step 7: Commit the offline playback closure slice**

```bash
git add lib/features/player/data/local_playback_resolver.dart lib/features/player/application/player_controller.dart test/features/player/data/local_playback_resolver_test.dart test/features/player/application/player_controller_test.dart

git commit -m "$(cat <<'EOF'
feat: prefer local playback for downloaded tracks
EOF
)"
```

---

### Task 4: Add the Library downloads management UI

**Files:**
- Create: `lib/features/library/presentation/widgets/downloads_management_section.dart`
- Modify: `lib/features/library/presentation/library_page.dart`
- Modify: `test/features/library/presentation/library_page_golden_test.dart`

- [ ] **Step 1: Write the failing Library downloads-management test**

Append this test to `test/features/library/presentation/library_page_golden_test.dart`:

```dart
testWidgets('library manage tab shows downloaded tracks and allows deleting one', (tester) async {
  final storage = TestLibraryStorage();
  final container = ProviderContainer(
    overrides: [
      libraryStorageProvider.overrideWithValue(storage),
      downloadLibraryRepositoryProvider.overrideWithValue(
        DownloadLibraryRepository(
          recordStore: InMemoryDownloadRecordStore(<DownloadRecord>[]),
          fileExists: (path) async => true,
          deleteFile: (path) async {},
        ),
      ),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: const TuneFreeGoldenTestApp(child: LibraryPage()),
    ),
  );
  await tester.pumpAndSettle();

  await tester.tap(find.text('管理'));
  await tester.pumpAndSettle();

  expect(find.text('已下载歌曲'), findsOneWidget);
});
```

- [ ] **Step 2: Run the Library golden test to verify the downloads-management UI does not exist yet**

Run:

```bash
flutter test test/features/library/presentation/library_page_golden_test.dart -r expanded
```

Expected: FAIL because the manage tab does not yet show a downloads section.

- [ ] **Step 3: Create the downloads management section widget**

Create `lib/features/library/presentation/widgets/downloads_management_section.dart`:

```dart
import 'package:flutter/material.dart';

import '../../../player/data/download_library_repository.dart';
import 'settings_card.dart';

class DownloadsManagementSection extends StatelessWidget {
  const DownloadsManagementSection({
    super.key,
    required this.downloads,
    required this.onDelete,
  });

  final List<DownloadedTrackItem> downloads;
  final Future<void> Function(DownloadedTrackItem item) onDelete;

  @override
  Widget build(BuildContext context) {
    return SettingsCard(
      title: '已下载歌曲',
      icon: Icons.download_done_rounded,
      child: downloads.isEmpty
          ? const Text(
              '暂无已下载歌曲',
              style: TextStyle(fontSize: 14, color: Color(0xFF6B7280)),
            )
          : Column(
              children: downloads
                  .map(
                    (item) => ListTile(
                      key: Key('downloaded-track-${item.songKey}-${item.quality}'),
                      contentPadding: EdgeInsets.zero,
                      title: Text(item.songName),
                      subtitle: Text('${item.artist} · ${item.quality}'),
                      trailing: IconButton(
                        key: Key('delete-downloaded-track-${item.songKey}-${item.quality}'),
                        onPressed: () async {
                          await onDelete(item);
                        },
                        icon: const Icon(Icons.delete_outline_rounded),
                      ),
                    ),
                  )
                  .toList(growable: false),
            ),
    );
  }
}
```

- [ ] **Step 4: Wire the downloads section into the Library manage tab**

Update `lib/features/library/presentation/library_page.dart`.

Add import:

```dart
import 'widgets/downloads_management_section.dart';
```

In `_ManageTab(...)`, insert `DownloadsManagementSection(...)` above the backup/settings cards:

```dart
            DownloadsManagementSection(
              downloads: state.downloads,
              onDelete: (item) async {
                try {
                  await controller.deleteDownload(item);
                  if (!context.mounted) {
                    return;
                  }
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('已删除 ${item.songName}')),
                  );
                } catch (_) {
                  if (!context.mounted) {
                    return;
                  }
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(content: Text('删除失败，请稍后重试')),
                  );
                }
              },
            ),
            const SizedBox(height: 20),
```

- [ ] **Step 5: Run the Library golden test and analyzer**

Run:

```bash
flutter test test/features/library/presentation/library_page_golden_test.dart -r expanded
flutter analyze lib/features/library/presentation/widgets/downloads_management_section.dart lib/features/library/presentation/library_page.dart test/features/library/presentation/library_page_golden_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the downloads management UI slice**

```bash
git add lib/features/library/presentation/widgets/downloads_management_section.dart lib/features/library/presentation/library_page.dart test/features/library/presentation/library_page_golden_test.dart

git commit -m "$(cat <<'EOF'
feat: add downloads management surface
EOF
)"
```

---

### Task 5: Replace default Flutter app icons with the source project icon and run full verification

**Files:**
- Modify: `android/app/src/main/res/mipmap-hdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-mdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png`
- Modify: `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`
- Modify: `ios/Runner/Assets.xcassets/AppIcon.appiconset/*`
- Modify: `web/icons/Icon-192.png`
- Modify: `web/icons/Icon-512.png`
- Modify: `web/icons/Icon-maskable-192.png`
- Modify: `web/icons/Icon-maskable-512.png`

- [ ] **Step 1: Identify the source project icon asset and prepare the replacement set**

Use the source project assets already in the repo (or the legacy app icon source) and replace the default Flutter launcher/web icons with that design. Keep the exact file names that Flutter/Xcode/Android already expect so no code/config changes are required.

The expected result is that these files are replaced in-place:

```text
android/app/src/main/res/mipmap-hdpi/ic_launcher.png
android/app/src/main/res/mipmap-mdpi/ic_launcher.png
android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
ios/Runner/Assets.xcassets/AppIcon.appiconset/*
web/icons/Icon-192.png
web/icons/Icon-512.png
web/icons/Icon-maskable-192.png
web/icons/Icon-maskable-512.png
```

- [ ] **Step 2: Run a targeted verification that icon-bearing surfaces still analyze and the app still builds tests**

Run:

```bash
flutter test test/app/tune_free_app_test.dart -r expanded
flutter analyze
```

Expected: PASS / `No issues found!`

- [ ] **Step 3: Build an Android APK for manual verification**

Run:

```bash
flutter build apk --debug
```

Expected: APK built successfully under `build/app/outputs/flutter-apk/`.

- [ ] **Step 4: Run the full regression sweep**

Run:

```bash
flutter test
flutter analyze
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the offline/download management completion slice**

```bash
git add android ios web lib test

git commit -m "$(cat <<'EOF'
feat: close offline playback and download management loop
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers every required piece from `docs/superpowers/specs/2026-04-17-download-management-and-offline-playback-design.md`:

- download record/file query expansion
- download management repository and Library-side state
- local playback resolver and local-first playback path
- downloads management UI in the Library area
- source project app icon parity
- focused and broad verification, including APK build for manual inspection

### Placeholder scan

No `TODO`, `TBD`, or “implement later” placeholders remain. Each task contains concrete files, code, commands, and expected outcomes.

### Type consistency

This plan consistently uses these symbols throughout:
- `DownloadRecordStore.listAll()`
- `DownloadRecordStore.listBySongKey()`
- `DownloadLibraryRepository`
- `DownloadedTrackItem`
- `LocalPlaybackResolver`
- `LocalPlaybackMatch`
- `DownloadsManagementSection`

Later tasks reuse the same names and interfaces without renaming drift.
