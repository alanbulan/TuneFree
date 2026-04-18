# Shared Foundation and Source Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared models, source/repository layer, and visual parity foundation required to deliver 1:1 Flutter parity with the legacy TuneFree app.

**Architecture:** This plan creates the shared base that every remaining parity slice depends on: immutable domain models matching `legacy/react_app/types.ts`, source clients and repositories matching `legacy/react_app/services/*.ts`, and app-wide theme/layout tokens matching the current screenshots and legacy shell. The intent is to stop feature work from hardcoding legacy assumptions into UI files by moving data normalization, source routing, and shared visual constants into focused reusable files.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, Dio, freezed, json_serializable, golden_toolkit, flutter_test

---

## Scope Check

The full 1:1 rewrite is too large for a single plan. This plan covers only the shared cross-feature foundation. Follow-on plans must implement Home/Search, Library, real player engine, and full player surface parity on top of this base.

## File Structure

### Files created or modified in this plan

- Modify: `./pubspec.yaml`
- Modify: `./test/flutter_test_config.dart`
- Create: `./lib/core/models/audio_quality.dart`
- Create: `./lib/core/models/song.dart`
- Create: `./lib/core/models/playlist.dart`
- Create: `./lib/core/models/top_list.dart`
- Create: `./lib/core/models/parsed_lyric.dart`
- Create: `./lib/core/models/music_source.dart`
- Create: `./lib/core/network/tune_free_http_client.dart`
- Create: `./lib/core/network/tune_free_exception.dart`
- Create: `./lib/core/source_clients/netease_client.dart`
- Create: `./lib/core/source_clients/qq_client.dart`
- Create: `./lib/core/source_clients/kuwo_client.dart`
- Create: `./lib/core/source_clients/gd_studio_client.dart`
- Create: `./lib/core/source_clients/tunehub_client.dart`
- Create: `./lib/features/home/data/top_list_repository.dart`
- Create: `./lib/features/search/data/search_repository.dart`
- Create: `./lib/features/library/data/playlist_import_repository.dart`
- Create: `./lib/features/player/data/song_resolution_repository.dart`
- Create: `./lib/shared/theme/tune_free_palette.dart`
- Create: `./lib/shared/theme/tune_free_spacing.dart`
- Create: `./lib/shared/theme/tune_free_text_styles.dart`
- Create: `./lib/shared/widgets/tune_free_card.dart`
- Create: `./lib/shared/widgets/tune_free_badge.dart`
- Create: `./lib/shared/widgets/tune_free_loading_tile.dart`
- Create: `./test/core/models/song_test.dart`
- Create: `./test/core/repositories/source_repository_test.dart`
- Create: `./test/shared/goldens/tune_free_golden_test_app.dart`
- Create: `./test/shared/goldens/shared_theme_golden_test.dart`
- Create: `./test/shared/reference/home_reference.png`
- Create: `./test/shared/reference/search_reference.png`
- Create: `./test/shared/reference/player_reference.png`

### Legacy files used as the reference source of truth

- `./legacy/react_app/types.ts`
- `./legacy/react_app/services/api.ts`
- `./legacy/react_app/services/netease.ts`
- `./legacy/react_app/services/qq.ts`
- `./legacy/react_app/services/kuwo.ts`
- `./legacy/react_app/services/gdStudio.ts`
- `./legacy/react_app/services/tunehub.ts`
- `./legacy/react_app/services/resolver.ts`
- `./legacy/react_app/utils/musicSource.ts`
- `./legacy/react_app/home.PNG`
- `./legacy/react_app/search.PNG`
- `./legacy/react_app/player.PNG`

---

### Task 1: Add immutable shared domain models

**Files:**
- Modify: `./pubspec.yaml`
- Create: `./lib/core/models/audio_quality.dart`
- Create: `./lib/core/models/song.dart`
- Create: `./lib/core/models/playlist.dart`
- Create: `./lib/core/models/top_list.dart`
- Create: `./lib/core/models/parsed_lyric.dart`
- Create: `./lib/core/models/music_source.dart`
- Test: `./test/core/models/song_test.dart`

- [ ] **Step 1: Write the failing model test**

Create `test/core/models/song_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';

void main() {
  test('song key and JSON mapping mirror the legacy model', () {
    final song = Song.fromJson(const {
      'id': '123',
      'name': '海与你',
      'artist': '马也_Crabbit',
      'album': '单曲',
      'source': 'netease',
      'types': ['128k', '320k', 'flac'],
      'pic': 'https://example.com/cover.jpg',
      'lrc': '[00:00.00]海与你',
    });

    expect(song.key, 'netease:123');
    expect(song.audioQualities, [AudioQuality.k128, AudioQuality.k320, AudioQuality.flac]);
    expect(song.source, MusicSource.netease);
    expect(song.toJson()['artist'], '马也_Crabbit');
  });
}
```

- [ ] **Step 2: Run the model test to verify the models do not exist yet**

Run:

```bash
flutter test test/core/models/song_test.dart -r expanded
```

Expected: FAIL with import errors for `core/models/song.dart`, `audio_quality.dart`, or `music_source.dart`.

- [ ] **Step 3: Add the shared model files and required package support**

Modify `pubspec.yaml` so these dependencies exist:

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

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0
  build_runner: ^2.8.0
  freezed: ^3.2.2
  json_serializable: ^6.11.1
```

Create `lib/core/models/audio_quality.dart`:

```dart
enum AudioQuality { k128, k320, flac, flac24bit }

extension AudioQualityWire on AudioQuality {
  String get wireValue => switch (this) {
        AudioQuality.k128 => '128k',
        AudioQuality.k320 => '320k',
        AudioQuality.flac => 'flac',
        AudioQuality.flac24bit => 'flac24bit',
      };

  static AudioQuality fromWire(String value) => switch (value) {
        '128k' => AudioQuality.k128,
        '320k' => AudioQuality.k320,
        'flac' => AudioQuality.flac,
        'flac24bit' => AudioQuality.flac24bit,
        _ => AudioQuality.k320,
      };
}
```

Create `lib/core/models/music_source.dart`:

```dart
enum MusicSource { netease, qq, kuwo, joox, bilibili, unknown }

extension MusicSourceWire on MusicSource {
  String get wireValue => switch (this) {
        MusicSource.netease => 'netease',
        MusicSource.qq => 'qq',
        MusicSource.kuwo => 'kuwo',
        MusicSource.joox => 'joox',
        MusicSource.bilibili => 'bilibili',
        MusicSource.unknown => 'unknown',
      };

  static MusicSource fromWire(String value) => switch (value) {
        'netease' => MusicSource.netease,
        'qq' => MusicSource.qq,
        'kuwo' => MusicSource.kuwo,
        'joox' => MusicSource.joox,
        'bilibili' => MusicSource.bilibili,
        _ => MusicSource.unknown,
      };
}
```

Create `lib/core/models/song.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import 'audio_quality.dart';
import 'music_source.dart';

part 'song.freezed.dart';
part 'song.g.dart';

@freezed
abstract class Song with _$Song {
  const Song._();

  const factory Song({
    required String id,
    required String name,
    required String artist,
    @Default('') String album,
    String? pic,
    String? picId,
    String? url,
    String? urlId,
    String? lrc,
    String? lyricId,
    @JsonKey(fromJson: _sourceFromJson, toJson: _sourceToJson) required MusicSource source,
    @JsonKey(fromJson: _audioQualitiesFromJson, toJson: _audioQualitiesToJson)
    @Default(<AudioQuality>[]) List<AudioQuality> audioQualities,
  }) = _Song;

  factory Song.fromJson(Map<String, dynamic> json) => _$SongFromJson(json);

  String get key => '${source.wireValue}:$id';
}

MusicSource _sourceFromJson(String value) => MusicSourceWire.fromWire(value);
String _sourceToJson(MusicSource source) => source.wireValue;
List<AudioQuality> _audioQualitiesFromJson(List<dynamic>? raw) =>
    (raw ?? const <dynamic>[]).map((item) => AudioQualityWire.fromWire(item as String)).toList(growable: false);
List<String> _audioQualitiesToJson(List<AudioQuality> values) =>
    values.map((value) => value.wireValue).toList(growable: false);
```

Create `lib/core/models/playlist.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import 'song.dart';

part 'playlist.freezed.dart';
part 'playlist.g.dart';

@freezed
abstract class Playlist with _$Playlist {
  const factory Playlist({
    required String id,
    required String name,
    required int createTime,
    @Default(<Song>[]) List<Song> songs,
  }) = _Playlist;

  factory Playlist.fromJson(Map<String, dynamic> json) => _$PlaylistFromJson(json);
}
```

Create `lib/core/models/top_list.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'top_list.freezed.dart';
part 'top_list.g.dart';

@freezed
abstract class TopList with _$TopList {
  const factory TopList({
    required String id,
    required String name,
    String? updateFrequency,
    String? picUrl,
    String? coverImgUrl,
  }) = _TopList;

  factory TopList.fromJson(Map<String, dynamic> json) => _$TopListFromJson(json);
}
```

Create `lib/core/models/parsed_lyric.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'parsed_lyric.freezed.dart';
part 'parsed_lyric.g.dart';

@freezed
abstract class ParsedLyric with _$ParsedLyric {
  const factory ParsedLyric({
    required double time,
    required String text,
    String? translation,
  }) = _ParsedLyric;

  factory ParsedLyric.fromJson(Map<String, dynamic> json) => _$ParsedLyricFromJson(json);
}
```

Run code generation:

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 4: Run the model test and analyzer to verify the models pass**

Run:

```bash
flutter test test/core/models/song_test.dart -r expanded
flutter analyze lib/core/models
```

Expected:
- the model test PASSes
- `flutter analyze lib/core/models` reports `No issues found!`

- [ ] **Step 5: Commit the shared model slice**

```bash
git add pubspec.yaml lib/core/models test/core/models

git commit -m "$(cat <<'EOF'
feat: add shared parity domain models
EOF
)"
```

---

### Task 2: Add source clients and repositories that match legacy behavior

**Files:**
- Create: `./lib/core/network/tune_free_exception.dart`
- Create: `./lib/core/network/tune_free_http_client.dart`
- Create: `./lib/core/source_clients/netease_client.dart`
- Create: `./lib/core/source_clients/qq_client.dart`
- Create: `./lib/core/source_clients/kuwo_client.dart`
- Create: `./lib/core/source_clients/gd_studio_client.dart`
- Create: `./lib/core/source_clients/tunehub_client.dart`
- Create: `./lib/features/home/data/top_list_repository.dart`
- Create: `./lib/features/search/data/search_repository.dart`
- Create: `./lib/features/library/data/playlist_import_repository.dart`
- Create: `./lib/features/player/data/song_resolution_repository.dart`
- Test: `./test/core/repositories/source_repository_test.dart`

- [ ] **Step 1: Write the failing repository test**

Create `test/core/repositories/source_repository_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/search/data/search_repository.dart';

void main() {
  test('aggregate search interleaves source results and tolerates failures', () async {
    final repository = SearchRepository.test(
      neteaseSearch: (_, __) async => [
        Song(
          id: 'n1',
          name: '网易歌曲',
          artist: '歌手A',
          source: MusicSource.netease,
        ),
      ],
      qqSearch: (_, __) async => [
        Song(
          id: 'q1',
          name: 'QQ歌曲',
          artist: '歌手B',
          source: MusicSource.qq,
        ),
      ],
      kuwoSearch: (_, __) async => throw Exception('offline'),
    );

    final result = await repository.searchAggregate('test', page: 1);

    expect(result.map((song) => song.key).toList(), ['netease:n1', 'qq:q1']);
  });
}
```

- [ ] **Step 2: Run the repository test to verify the repository layer does not exist yet**

Run:

```bash
flutter test test/core/repositories/source_repository_test.dart -r expanded
```

Expected: FAIL with import errors for `search_repository.dart`.

- [ ] **Step 3: Implement the HTTP client, source adapters, and repositories**

Create `lib/core/network/tune_free_exception.dart`:

```dart
class TuneFreeException implements Exception {
  TuneFreeException(this.message);

  final String message;

  @override
  String toString() => 'TuneFreeException($message)';
}
```

Create `lib/core/network/tune_free_http_client.dart`:

```dart
import 'package:dio/dio.dart';

final class TuneFreeHttpClient {
  TuneFreeHttpClient({Dio? dio}) : dio = dio ?? Dio();

  final Dio dio;
}
```

Create `lib/features/search/data/search_repository.dart`:

```dart
import '../../../core/models/song.dart';

typedef SearchFunction = Future<List<Song>> Function(String keyword, int page);

final class SearchRepository {
  SearchRepository({
    required SearchFunction neteaseSearch,
    required SearchFunction qqSearch,
    required SearchFunction kuwoSearch,
    SearchFunction? jooxSearch,
    SearchFunction? bilibiliSearch,
  })  : _neteaseSearch = neteaseSearch,
        _qqSearch = qqSearch,
        _kuwoSearch = kuwoSearch,
        _jooxSearch = jooxSearch,
        _bilibiliSearch = bilibiliSearch;

  SearchRepository.test({
    required SearchFunction neteaseSearch,
    required SearchFunction qqSearch,
    required SearchFunction kuwoSearch,
    SearchFunction? jooxSearch,
    SearchFunction? bilibiliSearch,
  }) : this(
          neteaseSearch: neteaseSearch,
          qqSearch: qqSearch,
          kuwoSearch: kuwoSearch,
          jooxSearch: jooxSearch,
          bilibiliSearch: bilibiliSearch,
        );

  final SearchFunction _neteaseSearch;
  final SearchFunction _qqSearch;
  final SearchFunction _kuwoSearch;
  final SearchFunction? _jooxSearch;
  final SearchFunction? _bilibiliSearch;

  Future<List<Song>> searchAggregate(String keyword, {required int page, bool includeExtendedSources = false}) async {
    final functions = <SearchFunction>[
      _neteaseSearch,
      _qqSearch,
      _kuwoSearch,
      if (includeExtendedSources && _jooxSearch != null) _jooxSearch!,
      if (includeExtendedSources && _bilibiliSearch != null) _bilibiliSearch!,
    ];

    final results = await Future.wait(
      functions.map((search) async {
        try {
          return await search(keyword, page);
        } catch (_) {
          return <Song>[];
        }
      }),
    );

    final merged = <Song>[];
    final maxLength = results.fold<int>(0, (max, current) => current.length > max ? current.length : max);
    for (var index = 0; index < maxLength; index += 1) {
      for (final sourceResult in results) {
        if (index < sourceResult.length) {
          merged.add(sourceResult[index]);
        }
      }
    }
    return merged;
  }
}
```

Create stub adapters that compile and can be filled in by feature plans:

```dart
// lib/core/source_clients/netease_client.dart
import '../models/song.dart';
import '../models/top_list.dart';

abstract class NeteaseClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}
```

```dart
// lib/core/source_clients/qq_client.dart
import '../models/song.dart';
import '../models/top_list.dart';

abstract class QqClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}
```

```dart
// lib/core/source_clients/kuwo_client.dart
import '../models/song.dart';
import '../models/top_list.dart';

abstract class KuwoClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}
```

```dart
// lib/core/source_clients/gd_studio_client.dart
import '../models/song.dart';

abstract class GdStudioClient {
  Future<List<Song>> search(String keyword, String source, int page);
}
```

```dart
// lib/core/source_clients/tunehub_client.dart
import '../models/song.dart';

abstract class TunehubClient {
  Future<List<Song>> importPlaylist(String source, String id);
  Future<Song> resolveSong(Song song, String quality);
}
```

Create small repository shells so downstream plans have stable targets:

```dart
// lib/features/home/data/top_list_repository.dart
import '../../../core/models/top_list.dart';
import '../../../core/models/song.dart';

abstract class TopListRepository {
  Future<List<TopList>> getTopLists(String source);
  Future<List<Song>> getTopListDetail(String source, String id);
}
```

```dart
// lib/features/library/data/playlist_import_repository.dart
import '../../../core/models/song.dart';

abstract class PlaylistImportRepository {
  Future<(String name, List<Song> songs)?> importPlaylist({required String source, required String id});
}
```

```dart
// lib/features/player/data/song_resolution_repository.dart
import '../../../core/models/song.dart';

abstract class SongResolutionRepository {
  Future<Song> resolveSong(Song song, {required String quality});
}
```

- [ ] **Step 4: Run repository tests and analyzer**

Run:

```bash
flutter test test/core/repositories/source_repository_test.dart -r expanded
flutter analyze lib/core lib/features/home/data lib/features/search/data lib/features/library/data lib/features/player/data
```

Expected:
- the repository test PASSes
- analyze reports `No issues found!`

- [ ] **Step 5: Commit the source foundation slice**

```bash
git add lib/core/network lib/core/source_clients lib/features/home/data lib/features/search/data lib/features/library/data lib/features/player/data test/core/repositories

git commit -m "$(cat <<'EOF'
feat: add source parity foundation
EOF
)"
```

---

### Task 3: Add shared theme tokens and parity golden harness

**Files:**
- Modify: `./test/flutter_test_config.dart`
- Create: `./lib/shared/theme/tune_free_palette.dart`
- Create: `./lib/shared/theme/tune_free_spacing.dart`
- Create: `./lib/shared/theme/tune_free_text_styles.dart`
- Create: `./lib/shared/widgets/tune_free_card.dart`
- Create: `./lib/shared/widgets/tune_free_badge.dart`
- Create: `./lib/shared/widgets/tune_free_loading_tile.dart`
- Create: `./test/shared/goldens/tune_free_golden_test_app.dart`
- Create: `./test/shared/goldens/shared_theme_golden_test.dart`
- Create: `./test/shared/reference/home_reference.png`
- Create: `./test/shared/reference/search_reference.png`
- Create: `./test/shared/reference/player_reference.png`

- [ ] **Step 1: Write the failing shared theme golden harness test**

Create `test/shared/goldens/shared_theme_golden_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:tunefree/shared/theme/tune_free_palette.dart';
import 'package:tunefree/shared/widgets/tune_free_card.dart';

import 'tune_free_golden_test_app.dart';

void main() {
  testGoldens('shared parity card uses the legacy surface palette', (tester) async {
    await tester.pumpWidgetBuilder(
      const TuneFreeGoldenTestApp(
        child: Center(
          child: TuneFreeCard(
            child: Text('排行榜'),
          ),
        ),
      ),
    );

    expect(find.text('排行榜'), findsOneWidget);
    final material = tester.widget<Material>(find.descendant(of: find.byType(TuneFreeCard), matching: find.byType(Material)));
    expect(material.color, TuneFreePalette.surface);
  });
}
```

- [ ] **Step 2: Run the golden harness test to verify the shared theme files do not exist yet**

Run:

```bash
flutter test test/shared/goldens/shared_theme_golden_test.dart -r expanded
```

Expected: FAIL with import errors for the shared theme/widget files.

- [ ] **Step 3: Add the shared theme files and reference assets**

Create `lib/shared/theme/tune_free_palette.dart`:

```dart
import 'package:flutter/material.dart';

final class TuneFreePalette {
  static const background = Color(0xFFF5F7FA);
  static const surface = Colors.white;
  static const accent = Color(0xFFE94B5B);
  static const textPrimary = Color(0xFF111111);
  static const textSecondary = Color(0xFF8B8B95);
  static const border = Color(0xFFF0F1F5);
}
```

Create `lib/shared/theme/tune_free_spacing.dart`:

```dart
final class TuneFreeSpacing {
  static const page = 20.0;
  static const section = 24.0;
  static const cardRadius = 24.0;
  static const chipRadius = 12.0;
}
```

Create `lib/shared/theme/tune_free_text_styles.dart`:

```dart
import 'package:flutter/material.dart';

import 'tune_free_palette.dart';

final class TuneFreeTextStyles {
  static const pageTitle = TextStyle(
    fontSize: 32,
    fontWeight: FontWeight.w700,
    color: TuneFreePalette.textPrimary,
  );

  static const sectionTitle = TextStyle(
    fontSize: 20,
    fontWeight: FontWeight.w700,
    color: TuneFreePalette.textPrimary,
  );

  static const body = TextStyle(
    fontSize: 14,
    color: TuneFreePalette.textSecondary,
  );
}
```

Create `lib/shared/widgets/tune_free_card.dart`:

```dart
import 'package:flutter/material.dart';

import '../theme/tune_free_palette.dart';
import '../theme/tune_free_spacing.dart';

class TuneFreeCard extends StatelessWidget {
  const TuneFreeCard({super.key, required this.child, this.padding = const EdgeInsets.all(12)});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: TuneFreePalette.surface,
      borderRadius: BorderRadius.circular(TuneFreeSpacing.cardRadius),
      child: Padding(
        padding: padding,
        child: child,
      ),
    );
  }
}
```

Create `lib/shared/widgets/tune_free_badge.dart`:

```dart
import 'package:flutter/material.dart';

class TuneFreeBadge extends StatelessWidget {
  const TuneFreeBadge({super.key, required this.text, required this.background, required this.foreground});

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: TextStyle(fontSize: 10, color: foreground, fontWeight: FontWeight.w600)),
    );
  }
}
```

Create `lib/shared/widgets/tune_free_loading_tile.dart`:

```dart
import 'package:flutter/material.dart';

class TuneFreeLoadingTile extends StatelessWidget {
  const TuneFreeLoadingTile({super.key});

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 72,
      child: ColoredBox(color: Color(0xFFE9ECF2)),
    );
  }
}
```

Create `test/shared/goldens/tune_free_golden_test_app.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:tunefree/shared/theme/tune_free_palette.dart';

class TuneFreeGoldenTestApp extends StatelessWidget {
  const TuneFreeGoldenTestApp({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: ColoredBox(
        color: TuneFreePalette.background,
        child: child,
      ),
    );
  }
}
```

Create or update `test/flutter_test_config.dart`:

```dart
import 'dart:async';

import 'package:golden_toolkit/golden_toolkit.dart';

Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  await loadAppFonts();
  return testMain();
}
```

Copy the visual references exactly once:

```bash
mkdir -p test/shared/reference
cp legacy/react_app/home.PNG test/shared/reference/home_reference.png
cp legacy/react_app/search.PNG test/shared/reference/search_reference.png
cp legacy/react_app/player.PNG test/shared/reference/player_reference.png
```

- [ ] **Step 4: Run the shared theme golden harness and analyzer**

Run:

```bash
flutter test test/shared/goldens/shared_theme_golden_test.dart -r expanded
flutter analyze lib/shared test/shared
```

Expected:
- the shared theme test PASSes
- analyze reports `No issues found!`

- [ ] **Step 5: Commit the parity theme foundation**

```bash
git add lib/shared test/shared test/flutter_test_config.dart

git commit -m "$(cat <<'EOF'
feat: add parity visual foundation
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers the shared cross-feature requirements from the redesign spec:
- immutable models matching the legacy app
- source/repository foundation for Home/Search/Library/player
- shared parity theme foundation and screenshot references

It intentionally does not implement page UIs, library flows, real playback, or player overlays.

### Placeholder scan

No TODO/TBD placeholders remain. Every task names exact files, code, and commands.

### Type consistency

All downstream plans should use the types introduced here:
- `Song`
- `Playlist`
- `TopList`
- `ParsedLyric`
- `MusicSource`
- `AudioQuality`
- `SearchRepository`
- `TopListRepository`
- `PlaylistImportRepository`
- `SongResolutionRepository`
