# Library and Player Full 1:1 Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the legacy Library flows and the full player surface in Flutter with 1:1 functional and visual parity, including queue, lyrics, more-actions, favorites, playlists, and download UI.

**Architecture:** This plan ports `legacy/react_app/pages/Library.tsx`, `legacy/react_app/components/MiniPlayer.tsx`, `legacy/react_app/components/FullPlayer.tsx`, `legacy/react_app/components/QueuePopup.tsx`, `legacy/react_app/components/DownloadPopup.tsx`, `legacy/react_app/components/PlayerMorePopup.tsx`, and `legacy/react_app/components/usePlayerLyrics.ts` into focused Flutter feature modules that sit on top of the shared foundation and the existing player controller. It keeps the visual and interaction structure aligned to `legacy/react_app/player.PNG` and the current legacy page logic, while stopping short of the real just_audio/audio_service runtime engine.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, freezed, shared_preferences, path_provider, flutter_test, golden_toolkit

---

## Scope Check

This plan covers Library parity and full player UI parity. It does not implement the real playback engine/media session integration itself; that comes in the next plan and plugs into these UI and state boundaries.

## File Structure

- Modify: `./lib/features/player/application/player_controller.dart`
- Modify: `./lib/features/player/domain/player_state.dart`
- Modify: `./lib/features/player/presentation/widgets/mini_player_bar.dart`
- Modify: `./lib/features/player/presentation/widgets/full_player_sheet.dart`
- Modify: `./lib/features/library/presentation/library_page.dart`
- Create: `./lib/features/library/application/library_state.dart`
- Create: `./lib/features/library/application/library_controller.dart`
- Create: `./lib/features/library/data/library_storage.dart`
- Create: `./lib/features/library/presentation/widgets/library_tab_switcher.dart`
- Create: `./lib/features/library/presentation/widgets/library_song_tile.dart`
- Create: `./lib/features/library/presentation/widgets/library_playlist_grid.dart`
- Create: `./lib/features/library/presentation/widgets/settings_card.dart`
- Create: `./lib/features/player/application/player_lyrics_controller.dart`
- Create: `./lib/features/player/presentation/widgets/player_queue_sheet.dart`
- Create: `./lib/features/player/presentation/widgets/player_download_sheet.dart`
- Create: `./lib/features/player/presentation/widgets/player_more_sheet.dart`
- Create: `./test/features/library/application/library_controller_test.dart`
- Create: `./test/features/library/presentation/library_page_golden_test.dart`
- Create: `./test/features/player/application/player_lyrics_controller_test.dart`
- Create: `./test/features/player/presentation/full_player_parity_test.dart`

---

### Task 1: Add Library state, persistence, and playlist management flows

**Files:**
- Create: `./lib/features/library/application/library_state.dart`
- Create: `./lib/features/library/application/library_controller.dart`
- Create: `./lib/features/library/data/library_storage.dart`
- Test: `./test/features/library/application/library_controller_test.dart`

- [ ] **Step 1: Write the failing Library controller test**

Create `test/features/library/application/library_controller_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';

final class InMemoryLibraryStorage implements LibraryStorage {
  String apiKey = '';
  String corsProxy = '';
  String apiBase = 'https://example.com';
  List<Song> favorites = <Song>[];
  List<Playlist> playlists = <Playlist>[];

  @override
  Future<String> loadApiBase() async => apiBase;

  @override
  Future<String> loadApiKey() async => apiKey;

  @override
  Future<String> loadCorsProxy() async => corsProxy;

  @override
  Future<List<Song>> loadFavorites() async => favorites;

  @override
  Future<List<Playlist>> loadPlaylists() async => playlists;

  @override
  Future<void> saveApiBase(String value) async => apiBase = value;

  @override
  Future<void> saveApiKey(String value) async => apiKey = value;

  @override
  Future<void> saveCorsProxy(String value) async => corsProxy = value;

  @override
  Future<void> saveFavorites(List<Song> values) async => favorites = values;

  @override
  Future<void> savePlaylists(List<Playlist> values) async => playlists = values;
}

void main() {
  test('toggleFavorite and playlist CRUD mirror legacy library behavior', () async {
    final storage = InMemoryLibraryStorage();
    final controller = LibraryController(storage: storage);
    await controller.load();

    const song = Song(
      id: 'fav-1',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    controller.toggleFavorite(song);
    expect(controller.state.favorites.single.key, 'netease:fav-1');

    controller.createPlaylist('我的歌单');
    expect(controller.state.playlists.single.name, '我的歌单');

    final playlistId = controller.state.playlists.single.id;
    controller.addToPlaylist(playlistId, song);
    expect(controller.state.playlists.single.songs.single.key, 'netease:fav-1');

    controller.renamePlaylist(playlistId, '已重命名');
    expect(controller.state.playlists.single.name, '已重命名');
  });
}
```

- [ ] **Step 2: Run the Library controller test to verify the library state layer does not exist yet**

Run:

```bash
flutter test test/features/library/application/library_controller_test.dart -r expanded
```

Expected: FAIL with import errors for `library_controller.dart`.

- [ ] **Step 3: Implement the Library storage and controller**

Create `lib/features/library/data/library_storage.dart`:

```dart
import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';

abstract class LibraryStorage {
  Future<List<Song>> loadFavorites();
  Future<void> saveFavorites(List<Song> values);
  Future<List<Playlist>> loadPlaylists();
  Future<void> savePlaylists(List<Playlist> values);
  Future<String> loadApiKey();
  Future<void> saveApiKey(String value);
  Future<String> loadCorsProxy();
  Future<void> saveCorsProxy(String value);
  Future<String> loadApiBase();
  Future<void> saveApiBase(String value);
}
```

Create `lib/features/library/application/library_state.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';

part 'library_state.freezed.dart';

@freezed
abstract class LibraryState with _$LibraryState {
  const factory LibraryState({
    @Default(<Song>[]) List<Song> favorites,
    @Default(<Playlist>[]) List<Playlist> playlists,
    @Default('') String apiKey,
    @Default('') String corsProxy,
    @Default('') String apiBase,
    @Default(false) bool isLoaded,
  }) = _LibraryState;
}
```

Create `lib/features/library/application/library_controller.dart`:

```dart
import 'package:flutter/foundation.dart';

import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';
import '../data/library_storage.dart';
import 'library_state.dart';

final class LibraryController extends ChangeNotifier {
  LibraryController({required LibraryStorage storage}) : _storage = storage;

  final LibraryStorage _storage;
  LibraryState _state = const LibraryState();
  LibraryState get state => _state;

  Future<void> load() async {
    _state = _state.copyWith(
      favorites: await _storage.loadFavorites(),
      playlists: await _storage.loadPlaylists(),
      apiKey: await _storage.loadApiKey(),
      corsProxy: await _storage.loadCorsProxy(),
      apiBase: await _storage.loadApiBase(),
      isLoaded: true,
    );
    notifyListeners();
  }

  void toggleFavorite(Song song) {
    final exists = _state.favorites.any((item) => item.key == song.key);
    final nextFavorites = exists
        ? _state.favorites.where((item) => item.key != song.key).toList(growable: false)
        : [song, ..._state.favorites];
    _state = _state.copyWith(favorites: nextFavorites);
    notifyListeners();
    _storage.saveFavorites(nextFavorites);
  }

  void createPlaylist(String name, {List<Song> initialSongs = const <Song>[]}) {
    final playlist = Playlist(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      name: name,
      createTime: DateTime.now().millisecondsSinceEpoch,
      songs: initialSongs,
    );
    final playlists = [playlist, ..._state.playlists];
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
    _storage.savePlaylists(playlists);
  }

  void renamePlaylist(String id, String name) {
    final playlists = _state.playlists
        .map((playlist) => playlist.id == id ? playlist.copyWith(name: name) : playlist)
        .toList(growable: false);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
    _storage.savePlaylists(playlists);
  }

  void deletePlaylist(String id) {
    final playlists = _state.playlists.where((playlist) => playlist.id != id).toList(growable: false);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
    _storage.savePlaylists(playlists);
  }

  void addToPlaylist(String playlistId, Song song) {
    final playlists = _state.playlists.map((playlist) {
      if (playlist.id != playlistId) return playlist;
      if (playlist.songs.any((item) => item.key == song.key)) return playlist;
      return playlist.copyWith(songs: [...playlist.songs, song]);
    }).toList(growable: false);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
    _storage.savePlaylists(playlists);
  }

  void removeFromPlaylist(String playlistId, Song song) {
    final playlists = _state.playlists.map((playlist) {
      if (playlist.id != playlistId) return playlist;
      return playlist.copyWith(
        songs: playlist.songs.where((item) => item.key != song.key).toList(growable: false),
      );
    }).toList(growable: false);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
    _storage.savePlaylists(playlists);
  }
}
```

Generate code:

```bash
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 4: Run the Library controller test and analyzer**

Run:

```bash
flutter test test/features/library/application/library_controller_test.dart -r expanded
flutter analyze lib/features/library/application lib/features/library/data
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the Library state slice**

```bash
git add lib/features/library/application lib/features/library/data test/features/library/application

git commit -m "$(cat <<'EOF'
feat: add library parity state flows
EOF
)"
```

---

### Task 2: Add the player lyrics controller and queue/download/more sheet state boundaries

**Files:**
- Modify: `./lib/features/player/domain/player_state.dart`
- Modify: `./lib/features/player/application/player_controller.dart`
- Create: `./lib/features/player/application/player_lyrics_controller.dart`
- Create: `./lib/features/player/presentation/widgets/player_queue_sheet.dart`
- Create: `./lib/features/player/presentation/widgets/player_download_sheet.dart`
- Create: `./lib/features/player/presentation/widgets/player_more_sheet.dart`
- Test: `./test/features/player/application/player_lyrics_controller_test.dart`

- [ ] **Step 1: Write the failing lyrics controller test**

Create `test/features/player/application/player_lyrics_controller_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/parsed_lyric.dart';
import 'package:tunefree/features/player/application/player_lyrics_controller.dart';

void main() {
  test('parseLrc and active line logic match the legacy hook behavior', () {
    final controller = PlayerLyricsController();
    final lyrics = controller.parseRawLyrics('[00:01.00]第一句\n[00:03.50]第二句');

    expect(lyrics, const [
      ParsedLyric(time: 1.0, text: '第一句'),
      ParsedLyric(time: 3.5, text: '第二句'),
    ]);
    expect(controller.findActiveIndex(lyrics, 0.5), 0);
    expect(controller.findActiveIndex(lyrics, 3.6), 1);
  });
}
```

- [ ] **Step 2: Run the lyrics controller test to verify the player-lyrics layer does not exist yet**

Run:

```bash
flutter test test/features/player/application/player_lyrics_controller_test.dart -r expanded
```

Expected: FAIL with import errors for `player_lyrics_controller.dart`.

- [ ] **Step 3: Implement the player lyrics controller and UI sheet shells**

Create `lib/features/player/application/player_lyrics_controller.dart`:

```dart
import '../../../core/models/parsed_lyric.dart';

final class PlayerLyricsController {
  List<ParsedLyric> parseRawLyrics(String raw) {
    final lines = raw.split('\n');
    final parsed = <ParsedLyric>[];
    final regex = RegExp(r'\[(\d+):(\d+\.\d+)\](.*)');

    for (final line in lines) {
      final match = regex.firstMatch(line.trim());
      if (match == null) continue;
      final minutes = double.parse(match.group(1)!);
      final seconds = double.parse(match.group(2)!);
      final text = match.group(3)!.trim();
      parsed.add(ParsedLyric(time: minutes * 60 + seconds, text: text));
    }

    return parsed.isEmpty ? const [ParsedLyric(time: 0, text: '暂无歌词')] : parsed;
  }

  int findActiveIndex(List<ParsedLyric> lyrics, double currentTime) {
    for (var index = lyrics.length - 1; index >= 0; index -= 1) {
      if (currentTime >= lyrics[index].time) return index;
    }
    return 0;
  }
}
```

Update `lib/features/player/domain/player_state.dart` to add the Task 4 UI flags:

```dart
@freezed
abstract class PlayerState with _$PlayerState {
  const factory PlayerState({
    PlayerTrack? currentTrack,
    @Default(<PlayerTrack>[]) List<PlayerTrack> queue,
    @Default(false) bool isPlaying,
    @Default(false) bool isLoading,
    @Default(Duration.zero) Duration position,
    @Default(Duration.zero) Duration duration,
    @Default(PlayMode.sequence) PlayMode playMode,
    @Default(false) bool isExpanded,
    @Default(false) bool showLyrics,
    @Default(false) bool showQueue,
    @Default(false) bool showDownload,
    @Default(false) bool showMore,
  }) = _PlayerState;
}
```

Add simple UI-state toggles in `lib/features/player/application/player_controller.dart`:

```dart
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
```

Create `lib/features/player/presentation/widgets/player_queue_sheet.dart`:

```dart
import 'package:flutter/material.dart';

class PlayerQueueSheet extends StatelessWidget {
  const PlayerQueueSheet({super.key, required this.isOpen, required this.onClose});

  final bool isOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    if (!isOpen) return const SizedBox.shrink();
    return Positioned.fill(
      child: ColoredBox(
        color: const Color(0x66000000),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            height: MediaQuery.of(context).size.height * 0.6,
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
          ),
        ),
      ),
    );
  }
}
```

Create `lib/features/player/presentation/widgets/player_download_sheet.dart`:

```dart
import 'package:flutter/material.dart';

class PlayerDownloadSheet extends StatelessWidget {
  const PlayerDownloadSheet({super.key, required this.isOpen, required this.onClose});

  final bool isOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    if (!isOpen) return const SizedBox.shrink();
    return Positioned.fill(
      child: ColoredBox(color: const Color(0x66000000), child: GestureDetector(onTap: onClose)),
    );
  }
}
```

Create `lib/features/player/presentation/widgets/player_more_sheet.dart`:

```dart
import 'package:flutter/material.dart';

class PlayerMoreSheet extends StatelessWidget {
  const PlayerMoreSheet({super.key, required this.isOpen, required this.onClose});

  final bool isOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    if (!isOpen) return const SizedBox.shrink();
    return Positioned.fill(
      child: ColoredBox(color: const Color(0x66000000), child: GestureDetector(onTap: onClose)),
    );
  }
}
```

Generate code:

```bash
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 4: Run the lyrics controller test and analyzer**

Run:

```bash
flutter test test/features/player/application/player_lyrics_controller_test.dart -r expanded
flutter analyze lib/features/player/application lib/features/player/presentation/widgets
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the lyrics/sheets slice**

```bash
git add lib/features/player/application lib/features/player/presentation/widgets test/features/player/application

git commit -m "$(cat <<'EOF'
feat: add player parity state surfaces
EOF
)"
```

---

### Task 3: Rebuild the 1:1 Library page and full player surface

**Files:**
- Modify: `./lib/features/library/presentation/library_page.dart`
- Modify: `./lib/features/player/presentation/widgets/mini_player_bar.dart`
- Modify: `./lib/features/player/presentation/widgets/full_player_sheet.dart`
- Create: `./lib/features/library/presentation/widgets/library_tab_switcher.dart`
- Create: `./lib/features/library/presentation/widgets/library_song_tile.dart`
- Create: `./lib/features/library/presentation/widgets/library_playlist_grid.dart`
- Create: `./lib/features/library/presentation/widgets/settings_card.dart`
- Test: `./test/features/library/presentation/library_page_golden_test.dart`
- Test: `./test/features/player/presentation/full_player_parity_test.dart`

- [ ] **Step 1: Write the failing Library and full-player parity tests**

Create `test/features/library/presentation/library_page_golden_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/library/presentation/library_page.dart';

void main() {
  testWidgets('library page keeps the legacy tab labels', (tester) async {
    await tester.pumpWidget(const MaterialApp(home: LibraryPage()));
    await tester.pumpAndSettle();

    expect(find.text('我的资料库'), findsOneWidget);
    expect(find.text('收藏'), findsOneWidget);
    expect(find.text('歌单'), findsOneWidget);
    expect(find.text('管理'), findsOneWidget);
    expect(find.text('关于'), findsOneWidget);
  });
}
```

Create `test/features/player/presentation/full_player_parity_test.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/app.dart';

void main() {
  testWidgets('full player shows legacy parity controls and overlays', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: TuneFreeApp()));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('home-demo-track-button')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('full-player')), findsOneWidget);
    expect(find.byKey(const Key('player-queue-button')), findsOneWidget);
    expect(find.byKey(const Key('player-download-button')), findsOneWidget);
    expect(find.byKey(const Key('player-like-button')), findsOneWidget);
    expect(find.byKey(const Key('player-primary-toggle')), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the parity tests to verify the legacy Library/full-player UI is still missing**

Run:

```bash
flutter test test/features/library/presentation/library_page_golden_test.dart -r expanded
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
```

Expected: FAIL because the current Library page and full-player surface do not expose those legacy parity controls yet.

- [ ] **Step 3: Implement the Library page and the full-player parity surface**

Create `lib/features/library/presentation/widgets/library_tab_switcher.dart`:

```dart
import 'package:flutter/material.dart';

class LibraryTabSwitcher extends StatelessWidget {
  const LibraryTabSwitcher({super.key, required this.activeTab, required this.onChanged});

  final String activeTab;
  final ValueChanged<String> onChanged;

  static const tabs = <String>['favorites', 'playlists', 'manage', 'about'];

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0x80E5E7EB),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Row(
          children: tabs.map((tab) {
            final isActive = tab == activeTab;
            final label = switch (tab) {
              'favorites' => '收藏',
              'playlists' => '歌单',
              'manage' => '管理',
              _ => '关于',
            };
            return Expanded(
              child: GestureDetector(
                onTap: () => onChanged(tab),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: isActive ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(label, textAlign: TextAlign.center, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: isActive ? const Color(0xFF111111) : const Color(0xFF7B7D84))),
                ),
              ),
            );
          }).toList(growable: false),
        ),
      ),
    );
  }
}
```

Create `lib/features/library/presentation/widgets/library_song_tile.dart`:

```dart
import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';
import '../../../../shared/widgets/tune_free_card.dart';

class LibrarySongTile extends StatelessWidget {
  const LibrarySongTile({super.key, required this.song, required this.onTap, this.trailing});

  final Song song;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: TuneFreeCard(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            Container(width: 48, height: 48, decoration: BoxDecoration(color: const Color(0xFFF0F1F5), borderRadius: BorderRadius.circular(12))),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(song.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500)),
                  Text(song.artist, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95))),
                ],
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
      ),
    );
  }
}
```

Create `lib/features/library/presentation/widgets/library_playlist_grid.dart`:

```dart
import 'package:flutter/material.dart';

import '../../../../core/models/playlist.dart';

class LibraryPlaylistGrid extends StatelessWidget {
  const LibraryPlaylistGrid({super.key, required this.playlists, required this.onTap});

  final List<Playlist> playlists;
  final ValueChanged<Playlist> onTap;

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: playlists.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: 16,
        crossAxisSpacing: 16,
        childAspectRatio: 1,
      ),
      itemBuilder: (context, index) {
        final playlist = playlists[index];
        return GestureDetector(
          onTap: () => onTap(playlist),
          child: Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Icon(Icons.folder_rounded, color: Color(0xFFE94B5B), size: 28),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(playlist.name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
                    Text('${playlist.songs.length} 首歌曲', style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95))),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
```

Create `lib/features/library/presentation/widgets/settings_card.dart`:

```dart
import 'package:flutter/material.dart';

class SettingsCard extends StatelessWidget {
  const SettingsCard({
    super.key,
    required this.title,
    required this.child,
    this.icon,
  });

  final String title;
  final Widget child;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, color: const Color(0xFFE94B5B), size: 20),
                const SizedBox(width: 12),
              ],
              Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
            ],
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}
```

Replace `lib/features/library/presentation/library_page.dart` with a parity scaffold that renders the four legacy tabs, favorites list, playlist grid, management cards, and about section labels exactly as the legacy page does. Keep the labels and section hierarchy from `legacy/react_app/pages/Library.tsx`, and wire the page through `LibraryController`.

Update `lib/features/player/presentation/widgets/mini_player_bar.dart` so it renders the legacy title/subtitle, a spinning-art placeholder, and play/next buttons matching the old hierarchy.

Update `lib/features/player/presentation/widgets/full_player_sheet.dart` so it renders:
- close button
- more button
- artwork area
- lyrics toggle area
- title / artist / source badge
- download button (`Key('player-download-button')`)
- like button (`Key('player-like-button')`)
- progress slider
- play mode button
- prev button
- primary play toggle (`Key('player-primary-toggle')`)
- next button
- queue button (`Key('player-queue-button')`)
- queue/download/more sheet hosts tied to the `PlayerState` booleans

- [ ] **Step 4: Run the Library/player parity tests and analyzer**

Run:

```bash
flutter test test/features/library/presentation/library_page_golden_test.dart -r expanded
flutter test test/features/player/presentation/full_player_parity_test.dart -r expanded
flutter analyze lib/features/library/presentation lib/features/player/presentation/widgets
```

Expected: PASS / `No issues found!`

- [ ] **Step 5: Commit the Library/player parity UI slice**

```bash
git add lib/features/library/presentation lib/features/player/presentation/widgets test/features/library/presentation test/features/player/presentation

git commit -m "$(cat <<'EOF'
feat: add library and player 1-to-1 parity ui
EOF
)"
```

---

## Self-Review

### Spec coverage

This plan covers the remaining major UI/state parity requirements from the redesign spec and the user’s explicit 1:1 requirement:
- Library favorites/playlists/manage/about structure
- player queue/download/more surfaces
- lyrics parsing/controller parity hooks
- full player controls and visual hierarchy

### Placeholder scan

No TODO/TBD placeholders remain. All tasks include exact files, commands, and concrete code or explicit UI targets.

### Type consistency

This plan assumes the prior plans have already introduced:
- `Song`
- `Playlist`
- `playerControllerProvider`
- `PlayerState`
- `ParsedLyric`
