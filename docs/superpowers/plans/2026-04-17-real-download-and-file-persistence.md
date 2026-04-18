# Real Download and File Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current download-preparation-only flow with a reliable single-track real download path that resolves the current song when needed, writes the audio file into app-private storage, records the result locally, and surfaces success/already-exists/failure behavior in the player download UI.

**Architecture:** This plan adds a dedicated download file store, a lightweight download record store, and a real player download manager that orchestrates song resolution, HTTP download, atomic file persistence, and record storage. The existing player download sheet remains the entry point, but its callback changes from “prepare” to a real download action while keeping the UI state minimal and focused on one in-flight track at a time.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, dio, path_provider, shared_preferences, flutter_test

---

## Scope Check

This plan covers one subsystem only: real single-track download and file persistence from the current player track. It intentionally does **not** cover batch downloads, playlist downloads, a download center, background task recovery, public Downloads directory integration, or offline playback switching.

## File Structure

- Modify: `lib/features/player/data/player_download_service.dart`
- Create: `lib/features/player/data/download_record.dart`
- Create: `lib/features/player/data/download_file_store.dart`
- Create: `lib/features/player/data/download_record_store.dart`
- Create: `lib/features/player/data/player_download_manager.dart`
- Modify: `lib/features/player/presentation/widgets/player_download_sheet.dart`
- Modify: `lib/features/player/presentation/widgets/full_player_sheet.dart`
- Test: `test/features/player/application/player_download_service_test.dart`
- Create: `test/features/player/application/player_download_manager_test.dart`
- Create: `test/features/player/data/download_file_store_test.dart`
- Create: `test/features/player/data/download_record_store_test.dart`
- Modify: `test/features/player/presentation/full_player_parity_test.dart`

Responsibility split:

- `download_record.dart` defines the persisted record model only.
- `download_file_store.dart` owns app-private paths, file-name sanitization, temp files, and file moves.
- `download_record_store.dart` owns local record persistence and stale-record validation.
- `player_download_manager.dart` owns the real orchestration path for one selected song download.
- `player_download_service.dart` becomes the small compatibility/provider facade that hands UI code a real manager-backed API.

---

### Task 1: Add download record and file store foundations

**Files:**
- Create: `lib/features/player/data/download_record.dart`
- Create: `lib/features/player/data/download_file_store.dart`
- Create: `test/features/player/data/download_file_store_test.dart`

- [ ] **Step 1: Write the failing file-store test**

Create `test/features/player/data/download_file_store_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_file_store.dart';

void main() {
  test('file store builds sanitized final and temp paths in app-private audio directory', () async {
    final fileStore = DownloadFileStore.test(rootDirectory: await Directory.systemTemp.createTemp('tf-downloads-'));
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    const song = Song(
      id: '123456',
      name: '海与你 / Live?',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    final target = await fileStore.createTarget(song: song, quality: AudioQuality.flac);

    expect(target.finalFile.path, contains('downloads'));
    expect(target.finalFile.path, contains('audio'));
    expect(target.finalFile.path, contains('[netease-123456].flac'));
    expect(target.finalFile.path, isNot(contains('/ Live?')));
    expect(target.temporaryFile.path, endsWith('.download'));
  });
}
```

- [ ] **Step 2: Run the file-store test to verify the file store does not exist yet**

Run:

```bash
flutter test test/features/player/data/download_file_store_test.dart -r expanded
```

Expected: FAIL with missing imports/types for `download_file_store.dart`.

- [ ] **Step 3: Create the download record model**

Create `lib/features/player/data/download_record.dart`:

```dart
class DownloadRecord {
  const DownloadRecord({
    required this.songKey,
    required this.songId,
    required this.songName,
    required this.artist,
    required this.quality,
    required this.filePath,
    required this.fileName,
    required this.downloadedAtIso8601,
  });

  final String songKey;
  final String songId;
  final String songName;
  final String artist;
  final String quality;
  final String filePath;
  final String fileName;
  final String downloadedAtIso8601;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'songKey': songKey,
      'songId': songId,
      'songName': songName,
      'artist': artist,
      'quality': quality,
      'filePath': filePath,
      'fileName': fileName,
      'downloadedAtIso8601': downloadedAtIso8601,
    };
  }

  factory DownloadRecord.fromJson(Map<String, dynamic> json) {
    return DownloadRecord(
      songKey: json['songKey'] as String? ?? '',
      songId: json['songId'] as String? ?? '',
      songName: json['songName'] as String? ?? '',
      artist: json['artist'] as String? ?? '',
      quality: json['quality'] as String? ?? '',
      filePath: json['filePath'] as String? ?? '',
      fileName: json['fileName'] as String? ?? '',
      downloadedAtIso8601: json['downloadedAtIso8601'] as String? ?? '',
    );
  }
}
```

- [ ] **Step 4: Create the download file store**

Create `lib/features/player/data/download_file_store.dart`:

```dart
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

class DownloadFileTarget {
  const DownloadFileTarget({
    required this.fileName,
    required this.finalFile,
    required this.temporaryFile,
  });

  final String fileName;
  final File finalFile;
  final File temporaryFile;
}

class DownloadFileStore {
  DownloadFileStore._({required Directory rootDirectory, this._deleteRootOnDispose = false})
      : _rootDirectory = rootDirectory;

  factory DownloadFileStore.real() {
    return DownloadFileStore._(rootDirectory: Directory('.'));
  }

  factory DownloadFileStore.test({required Directory rootDirectory}) {
    return DownloadFileStore._(
      rootDirectory: rootDirectory,
      _deleteRootOnDispose: true,
    );
  }

  final Directory _rootDirectory;
  final bool _deleteRootOnDispose;

  Future<DownloadFileTarget> createTarget({
    required Song song,
    required AudioQuality quality,
  }) async {
    final audioDirectory = await _resolveAudioDirectory();
    await audioDirectory.create(recursive: true);
    final extension = _extensionFor(quality);
    final fileName = _buildFileName(song, extension);
    final finalFile = File('${audioDirectory.path}/$fileName');
    final temporaryFile = File('${finalFile.path}.download');
    return DownloadFileTarget(
      fileName: fileName,
      finalFile: finalFile,
      temporaryFile: temporaryFile,
    );
  }

  Future<void> deleteTemporaryFile(File file) async {
    if (await file.exists()) {
      await file.delete();
    }
  }

  Future<void> promoteTemporaryFile({
    required File temporaryFile,
    required File finalFile,
  }) async {
    if (await finalFile.exists()) {
      await finalFile.delete();
    }
    await temporaryFile.rename(finalFile.path);
  }

  Future<bool> fileExists(String path) async {
    return File(path).exists();
  }

  Future<void> deleteTestRoot() async {
    if (_deleteRootOnDispose && await _rootDirectory.exists()) {
      await _rootDirectory.delete(recursive: true);
    }
  }

  Future<Directory> _resolveAudioDirectory() async {
    if (_deleteRootOnDispose) {
      return Directory('${_rootDirectory.path}/downloads/audio');
    }
    final documentsDirectory = await getApplicationDocumentsDirectory();
    return Directory('${documentsDirectory.path}/downloads/audio');
  }

  String _extensionFor(AudioQuality quality) {
    return switch (quality) {
      AudioQuality.k128 => 'mp3',
      AudioQuality.k320 => 'mp3',
      AudioQuality.flac => 'flac',
      AudioQuality.flac24bit => 'flac',
    };
  }

  String _buildFileName(Song song, String extension) {
    final artist = _sanitizeSegment(song.artist);
    final title = _sanitizeSegment(song.name);
    final source = _sanitizeSegment(song.source.wireValue);
    final id = _sanitizeSegment(song.id);
    return '$artist - $title [$source-$id].$extension';
  }

  String _sanitizeSegment(String value) {
    return value
        .replaceAll(RegExp(r'[\\/:*?"<>|]'), '_')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }
}
```

- [ ] **Step 5: Run the file-store test and analyzer**

Run:

```bash
flutter test test/features/player/data/download_file_store_test.dart -r expanded
flutter analyze lib/features/player/data/download_record.dart lib/features/player/data/download_file_store.dart test/features/player/data/download_file_store_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the file foundation slice**

```bash
git add lib/features/player/data/download_record.dart lib/features/player/data/download_file_store.dart test/features/player/data/download_file_store_test.dart

git commit -m "$(cat <<'EOF'
feat: add download file store foundation
EOF
)"
```

---

### Task 2: Add the download record store and stale-record validation

**Files:**
- Create: `lib/features/player/data/download_record_store.dart`
- Test: `test/features/player/data/download_record_store_test.dart`

- [ ] **Step 1: Write the failing record-store test**

Create `test/features/player/data/download_record_store_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';

void main() {
  test('record store saves, reloads, and removes stale records', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final store = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async => path.endsWith('present.flac'),
    );

    const record = DownloadRecord(
      songKey: 'netease:123456',
      songId: '123456',
      songName: '海与你',
      artist: '马也_Crabbit',
      quality: 'flac',
      filePath: '/downloads/present.flac',
      fileName: '马也_Crabbit - 海与你 [netease-123456].flac',
      downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
    );

    await store.save(record);
    final loaded = await store.load(songKey: 'netease:123456', quality: 'flac');
    expect(loaded?.filePath, '/downloads/present.flac');

    await store.save(
      const DownloadRecord(
        songKey: 'netease:123456',
        songId: '123456',
        songName: '海与你',
        artist: '马也_Crabbit',
        quality: '320k',
        filePath: '/downloads/missing.mp3',
        fileName: 'missing.mp3',
        downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
      ),
    );

    final stale = await store.load(songKey: 'netease:123456', quality: '320k');
    expect(stale, isNull);
  });
}
```

- [ ] **Step 2: Run the record-store test to verify the store does not exist yet**

Run:

```bash
flutter test test/features/player/data/download_record_store_test.dart -r expanded
```

Expected: FAIL with missing `download_record_store.dart`.

- [ ] **Step 3: Create the record-store implementation**

Create `lib/features/player/data/download_record_store.dart`:

```dart
import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'download_record.dart';

typedef DownloadFileExists = Future<bool> Function(String path);

abstract class DownloadRecordStore {
  Future<DownloadRecord?> load({required String songKey, required String quality});
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
    final records = _decodeRecords(preferences.getString(_storageKey));
    final recordKey = _recordKey(songKey, quality);
    final json = records[recordKey];
    if (json is! Map<String, dynamic>) {
      return null;
    }

    final record = DownloadRecord.fromJson(json);
    if (!await fileExists(record.filePath)) {
      records.remove(recordKey);
      await preferences.setString(_storageKey, jsonEncode(records));
      return null;
    }

    return record;
  }

  @override
  Future<void> save(DownloadRecord record) async {
    final preferences = await SharedPreferences.getInstance();
    final records = _decodeRecords(preferences.getString(_storageKey));
    records[_recordKey(record.songKey, record.quality)] = record.toJson();
    await preferences.setString(_storageKey, jsonEncode(records));
  }

  @override
  Future<void> remove({required String songKey, required String quality}) async {
    final preferences = await SharedPreferences.getInstance();
    final records = _decodeRecords(preferences.getString(_storageKey));
    records.remove(_recordKey(songKey, quality));
    await preferences.setString(_storageKey, jsonEncode(records));
  }

  Map<String, dynamic> _decodeRecords(String? rawValue) {
    if (rawValue == null || rawValue.isEmpty) {
      return <String, dynamic>{};
    }
    final decoded = jsonDecode(rawValue);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }

  String _recordKey(String songKey, String quality) => '$songKey::$quality';
}
```

- [ ] **Step 4: Run the record-store test and analyzer**

Run:

```bash
flutter test test/features/player/data/download_record_store_test.dart -r expanded
flutter analyze lib/features/player/data/download_record_store.dart test/features/player/data/download_record_store_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the record-store slice**

```bash
git add lib/features/player/data/download_record_store.dart test/features/player/data/download_record_store_test.dart

git commit -m "$(cat <<'EOF'
feat: persist downloaded track records
EOF
)"
```

---

### Task 3: Add the real player download manager and replace prepare-only downloads

**Files:**
- Modify: `lib/features/player/data/player_download_service.dart`
- Create: `lib/features/player/data/player_download_manager.dart`
- Test: `test/features/player/application/player_download_manager_test.dart`
- Modify: `test/features/player/application/player_download_service_test.dart`

- [ ] **Step 1: Write the failing download-manager test**

Create `test/features/player/application/player_download_manager_test.dart`:

```dart
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_file_store.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';
import 'package:tunefree/features/player/data/player_download_manager.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';

void main() {
  test('download manager downloads the song once and reuses an existing record later', () async {
    final rootDirectory = await Directory.systemTemp.createTemp('tf-download-manager-');
    final fileStore = DownloadFileStore.test(rootDirectory: rootDirectory);
    final recordStore = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async => File(path).exists(),
    );
    final service = PlayerDownloadManager(
      httpBytes: (url) async => utf8.encode('audio-bytes'),
      fileStore: fileStore,
      recordStore: recordStore,
      songResolutionRepository: SongResolutionRepository.test(
        resolveSongValue: (song, quality) async => song.copyWith(url: 'https://example.com/song.flac'),
      ),
    );
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    const song = Song(
      id: 'download-song',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    final first = await service.downloadSong(song, AudioQuality.flac);
    expect(first.alreadyExisted, isFalse);
    expect(await File(first.filePath).exists(), isTrue);

    final second = await service.downloadSong(song, AudioQuality.flac);
    expect(second.alreadyExisted, isTrue);
    expect(second.filePath, first.filePath);
  });
}
```

- [ ] **Step 2: Run the download-manager test to verify the manager does not exist yet**

Run:

```bash
flutter test test/features/player/application/player_download_manager_test.dart -r expanded
```

Expected: FAIL with missing `player_download_manager.dart`.

- [ ] **Step 3: Create the real download manager**

Create `lib/features/player/data/player_download_manager.dart`:

```dart
import 'dart:io';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'download_file_store.dart';
import 'download_record.dart';
import 'download_record_store.dart';
import 'song_resolution_repository.dart';

class DownloadResult {
  const DownloadResult({
    required this.song,
    required this.quality,
    required this.fileName,
    required this.filePath,
    required this.alreadyExisted,
  });

  final Song song;
  final AudioQuality quality;
  final String fileName;
  final String filePath;
  final bool alreadyExisted;
}

class PlayerDownloadManager {
  const PlayerDownloadManager({
    required Future<List<int>> Function(String url) httpBytes,
    required DownloadFileStore fileStore,
    required DownloadRecordStore recordStore,
    required SongResolutionRepository songResolutionRepository,
  })  : _httpBytes = httpBytes,
        _fileStore = fileStore,
        _recordStore = recordStore,
        _songResolutionRepository = songResolutionRepository;

  final Future<List<int>> Function(String url) _httpBytes;
  final DownloadFileStore _fileStore;
  final DownloadRecordStore _recordStore;
  final SongResolutionRepository _songResolutionRepository;

  Future<DownloadResult> downloadSong(Song song, AudioQuality quality) async {
    final resolvedSong = await _resolveSongIfNeeded(song, quality);
    final existingRecord = await _recordStore.load(
      songKey: resolvedSong.key,
      quality: quality.wireValue,
    );
    if (existingRecord != null) {
      return DownloadResult(
        song: resolvedSong,
        quality: quality,
        fileName: existingRecord.fileName,
        filePath: existingRecord.filePath,
        alreadyExisted: true,
      );
    }

    final url = resolvedSong.url;
    if (url == null || url.isEmpty) {
      throw StateError('download URL missing after resolution');
    }

    final target = await _fileStore.createTarget(song: resolvedSong, quality: quality);
    try {
      final bytes = await _httpBytes(url);
      await target.temporaryFile.writeAsBytes(bytes, flush: true);
      await _fileStore.promoteTemporaryFile(
        temporaryFile: target.temporaryFile,
        finalFile: target.finalFile,
      );
      final record = DownloadRecord(
        songKey: resolvedSong.key,
        songId: resolvedSong.id,
        songName: resolvedSong.name,
        artist: resolvedSong.artist,
        quality: quality.wireValue,
        filePath: target.finalFile.path,
        fileName: target.fileName,
        downloadedAtIso8601: DateTime.now().toUtc().toIso8601String(),
      );
      try {
        await _recordStore.save(record);
      } catch (_) {
        if (await target.finalFile.exists()) {
          await target.finalFile.delete();
        }
        rethrow;
      }

      return DownloadResult(
        song: resolvedSong,
        quality: quality,
        fileName: target.fileName,
        filePath: target.finalFile.path,
        alreadyExisted: false,
      );
    } catch (_) {
      await _fileStore.deleteTemporaryFile(target.temporaryFile);
      rethrow;
    }
  }

  Future<Song> _resolveSongIfNeeded(Song song, AudioQuality quality) {
    final url = song.url;
    if (url != null && url.isNotEmpty) {
      return Future<Song>.value(song);
    }
    return _songResolutionRepository.resolveSong(song, quality: quality.wireValue);
  }
}
```

- [ ] **Step 4: Replace the preparation-only service with a manager-backed provider API**

Replace `lib/features/player/data/player_download_service.dart` with:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import '../../../core/network/tune_free_http_client.dart';
import 'download_file_store.dart';
import 'download_record_store.dart';
import 'player_download_manager.dart';
import 'song_resolution_repository.dart';

final downloadFileStoreProvider = Provider<DownloadFileStore>((ref) {
  return DownloadFileStore.real();
});

final downloadRecordStoreProvider = Provider<DownloadRecordStore>((ref) {
  final fileStore = ref.watch(downloadFileStoreProvider);
  return SharedPreferencesDownloadRecordStore.real(fileExists: fileStore.fileExists);
});

final playerDownloadServiceProvider = Provider<PlayerDownloadService>((ref) {
  final httpClient = TuneFreeHttpClient();
  return PlayerDownloadService.real(
    manager: PlayerDownloadManager(
      httpBytes: (url) async {
        final response = await httpClient.dio.get<List<int>>(
          url,
          options: const Options(responseType: ResponseType.bytes),
        );
        final data = response.data;
        if (data == null) {
          throw StateError('download response body missing');
        }
        return data;
      },
      fileStore: ref.watch(downloadFileStoreProvider),
      recordStore: ref.watch(downloadRecordStoreProvider),
      songResolutionRepository: ref.watch(songResolutionRepositoryProvider),
    ),
  );
});

class PlayerDownloadService {
  const PlayerDownloadService._({
    required PlayerDownloadManager manager,
    this.downloadOverride,
  }) : _manager = manager;

  factory PlayerDownloadService.real({required PlayerDownloadManager manager}) =>
      PlayerDownloadService._(manager: manager);

  factory PlayerDownloadService.test({
    Future<DownloadResult> Function(Song song, AudioQuality quality)? download,
  }) => PlayerDownloadService._(
        manager: PlayerDownloadManager(
          httpBytes: (_) async => const <int>[],
          fileStore: DownloadFileStore.test(rootDirectory: Directory.systemTemp.createTempSync('unused-download-root')),
          recordStore: SharedPreferencesDownloadRecordStore.test(fileExists: (_) async => false),
          songResolutionRepository: SongResolutionRepository.test(
            resolveSongValue: (song, quality) async => song,
          ),
        ),
        downloadOverride: download,
      );

  final PlayerDownloadManager _manager;
  final Future<DownloadResult> Function(Song song, AudioQuality quality)? downloadOverride;

  Future<DownloadResult> downloadSong(Song song, AudioQuality quality) async {
    final override = downloadOverride;
    if (override != null) {
      return override(song, quality);
    }
    return _manager.downloadSong(song, quality);
  }
}
```

Also add these imports at the top of the file:

```dart
import 'dart:io';

import 'package:dio/dio.dart';
```

- [ ] **Step 5: Update and add tests for the manager-backed API**

Replace `test/features/player/application/player_download_service_test.dart` with:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/player_download_manager.dart';
import 'package:tunefree/features/player/data/player_download_service.dart';

void main() {
  test('download service forwards real download results through its public API', () async {
    final service = PlayerDownloadService.test(
      download: (song, quality) async => DownloadResult(
        song: song,
        quality: quality,
        fileName: '马也_Crabbit - 海与你 [netease-download-song].flac',
        filePath: '/downloads/song.flac',
        alreadyExisted: false,
      ),
    );
    const song = Song(
      id: 'download-song',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    final result = await service.downloadSong(song, AudioQuality.flac);

    expect(result.fileName, '马也_Crabbit - 海与你 [netease-download-song].flac');
    expect(result.filePath, '/downloads/song.flac');
    expect(result.alreadyExisted, isFalse);
  });
}
```

- [ ] **Step 6: Run the download-manager/service tests and analyzer**

Run:

```bash
flutter test test/features/player/application/player_download_manager_test.dart -r expanded
flutter test test/features/player/application/player_download_service_test.dart -r expanded
flutter analyze lib/features/player/data test/features/player/application/player_download_manager_test.dart test/features/player/application/player_download_service_test.dart
```

Expected: PASS / PASS / `No issues found!`

- [ ] **Step 7: Commit the real download manager slice**

```bash
git add lib/features/player/data test/features/player/application/player_download_manager_test.dart test/features/player/application/player_download_service_test.dart

git commit -m "$(cat <<'EOF'
feat: add real single-track download manager
EOF
)"
```

---

### Task 4: Wire the player download sheet to real downloads and cover UI outcomes

**Files:**
- Modify: `lib/features/player/presentation/widgets/player_download_sheet.dart`
- Modify: `lib/features/player/presentation/widgets/full_player_sheet.dart`
- Modify: `test/features/player/presentation/full_player_parity_test.dart`

- [ ] **Step 1: Write the failing player download UI test**

Add this test to `test/features/player/presentation/full_player_parity_test.dart`:

```dart
testWidgets('full player shows an already-downloaded message when the local file already exists', (tester) async {
  final downloadService = PlayerDownloadService.test(
    download: (song, quality) async => DownloadResult(
      song: song,
      quality: quality,
      fileName: '歌手甲 - 第一首 [netease-track-1].flac',
      filePath: '/downloads/track-1.flac',
      alreadyExisted: true,
    ),
  );

  await _pumpFullPlayer(
    tester,
    downloadService: downloadService,
  );

  await tester.tap(find.byKey(const Key('player-more-download-button')));
  await tester.pumpAndSettle();
  await tester.tap(find.byKey(const Key('player-download-option-flac')));
  await tester.pumpAndSettle();

  expect(find.text('该音质已下载'), findsOneWidget);
});
```

- [ ] **Step 2: Run the player parity test to verify the real download outcome does not exist yet**

Run:

```bash
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
```

Expected: FAIL because the UI still expects `DownloadPreparation` and does not distinguish already-exists from fresh success.

- [ ] **Step 3: Update the download sheet contract and UI result handling**

Update `lib/features/player/presentation/widgets/player_download_sheet.dart`:

- replace the import:

```dart
import '../../data/player_download_manager.dart';
```

- update the callback type in `PlayerDownloadSheet`:

```dart
final Future<DownloadResult> Function(AudioQuality quality) onDownload;
```

- update constructor field names from `onPrepareDownload` to `onDownload`

- replace the success handling block inside the option tile tap callback with:

```dart
final result = await widget.onDownload(quality);
if (!context.mounted) {
  return;
}
ScaffoldMessenger.of(context).showSnackBar(
  SnackBar(
    content: Text(
      result.alreadyExisted ? '该音质已下载' : '已下载到本地：${result.fileName}',
    ),
  ),
);
if (!result.alreadyExisted) {
  widget.onClose();
}
```

- keep the existing failure snackbar path:

```dart
const SnackBar(content: Text('下载失败，请稍后重试'))
```

Update `lib/features/player/presentation/widgets/full_player_sheet.dart` in the `PlayerDownloadSheet(...)` section:

```dart
PlayerDownloadSheet(
  isOpen: state.showDownload,
  song: song,
  selectedQuality: state.downloadQuality,
  onDownload: (quality) async {
    playerController.setDownloadQuality(quality);
    return downloadService.downloadSong(song, quality);
  },
  onClose: () => playerController.setShowDownload(false),
)
```

- [ ] **Step 4: Update the player parity test helpers to use the real result model**

In `test/features/player/presentation/full_player_parity_test.dart`, update any test download stubs that still return `DownloadPreparation` so they return `DownloadResult` instead.

For the existing success-path helper, use a result like:

```dart
DownloadResult(
  song: song,
  quality: quality,
  fileName: '歌手甲 - 第一首 [netease-track-1].flac',
  filePath: '/downloads/track-1.flac',
  alreadyExisted: false,
)
```

For the existing failure-path helper, keep throwing the test error.

- [ ] **Step 5: Run the player parity test and analyzer**

Run:

```bash
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
flutter analyze lib/features/player/presentation/widgets/player_download_sheet.dart lib/features/player/presentation/widgets/full_player_sheet.dart test/features/player/presentation/full_player_parity_test.dart
```

Expected: PASS / `No issues found!`

- [ ] **Step 6: Commit the real download UI wiring slice**

```bash
git add lib/features/player/presentation/widgets/player_download_sheet.dart lib/features/player/presentation/widgets/full_player_sheet.dart test/features/player/presentation/full_player_parity_test.dart

git commit -m "$(cat <<'EOF'
feat: wire player downloads to real file persistence
EOF
)"
```

---

### Task 5: Run the full regression sweep and validate single-track download boundaries

**Files:**
- Modify: `test/features/player/application/player_download_manager_test.dart`
- Modify: `test/features/player/presentation/full_player_parity_test.dart`

- [ ] **Step 1: Add final boundary tests for stale-record re-download and duplicate-tap protection**

Append this test to `test/features/player/application/player_download_manager_test.dart`:

```dart
test('stale records do not block a fresh download when the file is missing', () async {
  final rootDirectory = await Directory.systemTemp.createTemp('tf-stale-download-');
  final fileStore = DownloadFileStore.test(rootDirectory: rootDirectory);
  final recordStore = SharedPreferencesDownloadRecordStore.test(
    fileExists: (path) async => File(path).exists(),
  );
  final manager = PlayerDownloadManager(
    httpBytes: (url) async => utf8.encode('fresh-bytes'),
    fileStore: fileStore,
    recordStore: recordStore,
    songResolutionRepository: SongResolutionRepository.test(
      resolveSongValue: (song, quality) async => song.copyWith(url: 'https://example.com/song.flac'),
    ),
  );
  addTearDown(() async {
    await fileStore.deleteTestRoot();
  });

  await recordStore.save(
    const DownloadRecord(
      songKey: 'netease:stale-song',
      songId: 'stale-song',
      songName: '旧记录',
      artist: 'TuneFree',
      quality: 'flac',
      filePath: '/missing/file.flac',
      fileName: 'missing.flac',
      downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
    ),
  );

  const song = Song(
    id: 'stale-song',
    name: '旧记录',
    artist: 'TuneFree',
    source: MusicSource.netease,
  );

  final result = await manager.downloadSong(song, AudioQuality.flac);

  expect(result.alreadyExisted, isFalse);
  expect(await File(result.filePath).exists(), isTrue);
});
```

Append this widget test to `test/features/player/presentation/full_player_parity_test.dart`:

```dart
testWidgets('download sheet ignores repeated taps while a single download is in flight', (tester) async {
  final completer = Completer<DownloadResult>();
  var downloadCalls = 0;
  final downloadService = PlayerDownloadService.test(
    download: (song, quality) {
      downloadCalls += 1;
      return completer.future;
    },
  );

  await _pumpFullPlayer(
    tester,
    downloadService: downloadService,
  );

  await tester.tap(find.byKey(const Key('player-more-download-button')));
  await tester.pumpAndSettle();

  final option = find.byKey(const Key('player-download-option-flac'));
  await tester.tap(option);
  await tester.tap(option);
  await tester.pump();

  expect(downloadCalls, 1);

  completer.complete(
    DownloadResult(
      song: _demoSong,
      quality: AudioQuality.flac,
      fileName: '歌手甲 - 第一首 [netease-track-1].flac',
      filePath: '/downloads/track-1.flac',
      alreadyExisted: false,
    ),
  );
  await tester.pumpAndSettle();
});
```

- [ ] **Step 2: Run the focused download tests**

Run:

```bash
flutter test test/features/player/data/download_file_store_test.dart -r expanded
flutter test test/features/player/data/download_record_store_test.dart -r expanded
flutter test test/features/player/application/player_download_manager_test.dart -r expanded
flutter test test/features/player/application/player_download_service_test.dart -r expanded
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
```

Expected: PASS / PASS / PASS / PASS / PASS

- [ ] **Step 3: Run the broad verification suite**

Run:

```bash
flutter test
flutter analyze
```

Expected: PASS / `No issues found!`

- [ ] **Step 4: Commit the final real-download verification slice**

```bash
git add test/features/player/data/download_file_store_test.dart test/features/player/data/download_record_store_test.dart test/features/player/application/player_download_manager_test.dart test/features/player/application/player_download_service_test.dart test/features/player/presentation/full_player_parity_test.dart

git commit -m "$(cat <<'EOF'
test: verify real single-track download flow
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers each required piece from `docs/superpowers/specs/2026-04-17-real-download-and-file-persistence-design.md`:

- single-track real download only
- app-private file persistence
- deterministic sanitized file naming
- local record persistence and stale-record cleanup
- reuse of existing downloads for the same song + quality
- rollback on failed persistence
- minimal player download UI states
- focused manager/store/widget tests plus broad verification

### Placeholder scan

No `TODO`, `TBD`, or “implement later” placeholders remain. Each task includes exact files, code, commands, and expected outcomes.

### Type consistency

This plan defines and uses the same concrete symbols throughout:
- `DownloadRecord`
- `DownloadFileStore`
- `DownloadFileTarget`
- `DownloadRecordStore`
- `SharedPreferencesDownloadRecordStore`
- `PlayerDownloadManager`
- `DownloadResult`
- `PlayerDownloadService.downloadSong(...)`

Later tasks reuse the same names and interfaces consistently.
