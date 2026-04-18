# Flutter Root Replacement and Player Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the repository root with a runnable Flutter project, delete the old Android/Capacitor shell, and ship a tested app shell with a root-scoped player domain, mini player, and full player scaffold.

**Architecture:** This plan intentionally covers only the first executable slice of the approved redesign spec: root replacement, Flutter app shell, and player backbone. It preserves the old React/Vite code only as a frozen reference under `legacy/react_app/`, while the new Flutter app owns runtime, routing, and player state from day one.

**Tech Stack:** Flutter, Dart 3, flutter_riverpod, go_router, freezed, build_runner, flutter_test

---

## Scope Check

The approved design spec spans multiple independent subsystems. Do **not** try to execute the whole redesign from one plan. This plan only covers:

1. Root replacement with Flutter
2. Bottom-navigation app shell
3. Player domain models and controller
4. Mini player and full player scaffold

Follow-on plans are required for:

- Home/Search real data migration
- Library/favorites/playlists/settings migration
- Real audio engine + media session integration
- Lyrics, downloads, and platform-specific polish

The baseline worktree build already passed before plan writing:

```bash
npm run build
```

Expected baseline result before replacement: PASS in the legacy web app, so any later failures come from the Flutter migration rather than a pre-existing broken branch.

## File Structure

### Runtime files created or modified in this plan

- `./.gitignore` — remove the old `android/` ignore and add Flutter + local worktree ignores
- `./analysis_options.yaml` — Flutter analyzer defaults created by `flutter create`
- `./pubspec.yaml` — rename the app to `tunefree` and add the dependencies needed for the Flutter shell and player slice
- `./pubspec.lock` — Flutter dependency lockfile
- `./android/`, `./ios/`, `./web/`, `./windows/`, `./macos/`, `./linux/` — generated Flutter platform hosts
- `./lib/main.dart` — bootstrap `ProviderScope` and the app entry point
- `./lib/app/app.dart` — build the top-level `MaterialApp.router`
- `./lib/app/theme/app_theme.dart` — app theme for the new Flutter shell
- `./lib/app/router/app_router.dart` — define `/`, `/search`, `/library` routes inside the shell
- `./lib/app/shell/tune_free_shell.dart` — bottom navigation, page host, and player overlay host
- `./lib/features/home/presentation/home_page.dart` — placeholder home page plus a deterministic “open player scaffold” action
- `./lib/features/search/presentation/search_page.dart` — placeholder search page
- `./lib/features/library/presentation/library_page.dart` — placeholder library page
- `./lib/features/player/domain/play_mode.dart` — player repeat/shuffle enum
- `./lib/features/player/domain/player_track.dart` — immutable player track model
- `./lib/features/player/domain/player_state.dart` — immutable root player state
- `./lib/features/player/application/player_engine.dart` — engine contract and engine snapshot model
- `./lib/features/player/application/in_memory_player_engine.dart` — deterministic in-memory engine for the first slice
- `./lib/features/player/application/player_controller.dart` — Riverpod controller for the player domain
- `./lib/features/player/presentation/widgets/mini_player_bar.dart` — compact player surface above the nav bar
- `./lib/features/player/presentation/widgets/full_player_sheet.dart` — full-screen player scaffold controlled by the player controller
- `./test/app/tune_free_app_test.dart` — shell smoke test
- `./test/features/player/application/player_controller_test.dart` — player state/controller tests
- `./test/features/player/presentation/player_surface_test.dart` — UI interaction test for mini/full player flow

### Legacy reference files moved in Task 1

Move these into `./legacy/react_app/` so the Flutter root becomes the only runnable app while the old code remains available for feature-parity reference:

- `./App.tsx`
- `./index.tsx`
- `./components/`
- `./contexts/`
- `./functions/`
- `./pages/`
- `./public/`
- `./services/`
- `./utils/`
- `./types.ts`
- `./index.html`
- `./package.json`
- `./package-lock.json`
- `./tsconfig.json`
- `./vite.config.ts`
- `./wrangler.json`
- `./README.md`
- `./Api.txt`
- `./metadata.json`
- `./lx-music-sixyin.js`
- `./home.PNG`
- `./player.PNG`
- `./search.PNG`

### Files deleted in Task 1

- `./android/`
- `./capacitor.config.ts`
- `./dist/`
- `./node_modules/`

---

### Task 1: Replace the repo root with a Flutter shell

**Files:**
- Modify: `./.gitignore`
- Create: `./analysis_options.yaml`
- Create: `./pubspec.yaml`
- Create: `./pubspec.lock`
- Create: `./android/`, `./ios/`, `./web/`, `./windows/`, `./macos/`, `./linux/`
- Create: `./lib/main.dart`
- Create: `./lib/app/app.dart`
- Create: `./lib/app/theme/app_theme.dart`
- Create: `./lib/app/router/app_router.dart`
- Create: `./lib/app/shell/tune_free_shell.dart`
- Create: `./lib/features/home/presentation/home_page.dart`
- Create: `./lib/features/search/presentation/search_page.dart`
- Create: `./lib/features/library/presentation/library_page.dart`
- Test: `./test/app/tune_free_app_test.dart`
- Move: `./App.tsx`, `./index.tsx`, `./components/`, `./contexts/`, `./functions/`, `./pages/`, `./public/`, `./services/`, `./utils/`, `./types.ts`, `./index.html`, `./package.json`, `./package-lock.json`, `./tsconfig.json`, `./vite.config.ts`, `./wrangler.json`, `./README.md`, `./Api.txt`, `./metadata.json`, `./lx-music-sixyin.js`, `./home.PNG`, `./player.PNG`, `./search.PNG`
- Delete: `./android/`, `./capacitor.config.ts`, `./dist/`, `./node_modules/`

- [ ] **Step 1: Write the failing shell smoke test**

Create `test/app/tune_free_app_test.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/app.dart';

void main() {
  testWidgets('renders the Flutter shell with three tabs', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: TuneFreeApp()));
    await tester.pumpAndSettle();

    expect(find.text('TuneFree'), findsOneWidget);
    expect(find.text('首页'), findsOneWidget);
    expect(find.text('搜索'), findsOneWidget);
    expect(find.text('我的'), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the test to prove the repo is not a Flutter app yet**

Run:

```bash
flutter test test/app/tune_free_app_test.dart -r expanded
```

Expected: FAIL with a root-level Flutter error such as `No pubspec.yaml file found` or import errors for `package:tunefree/...`.

- [ ] **Step 3: Delete the old shell, move the legacy web app, create the Flutter app, and add the minimal shell implementation**

Run the filesystem changes:

```bash
mkdir -p legacy/react_app
rm -rf node_modules dist
git rm -r android capacitor.config.ts

git mv App.tsx index.tsx legacy/react_app/
git mv components contexts functions pages public services utils legacy/react_app/
git mv types.ts index.html package.json package-lock.json tsconfig.json vite.config.ts wrangler.json legacy/react_app/
git mv README.md Api.txt metadata.json lx-music-sixyin.js home.PNG player.PNG search.PNG legacy/react_app/

flutter create --platforms=android,ios,web,windows,macos,linux --org com.alanbulan .
```

Replace `./.gitignore` with:

```gitignore
# Flutter / Dart
.dart_tool/
.flutter-plugins
.flutter-plugins-dependencies
.packages
.pub/
build/
pubspec_overrides.yaml

# IDE / OS
.idea/
.vscode/
.DS_Store

# Legacy web reference artifacts
legacy/react_app/node_modules/
legacy/react_app/dist/

# Local Claude files
.worktrees/
.claude/settings.local.json
```

Update the dependency section in `./pubspec.yaml` so it starts from the Flutter template but uses this app name and these packages:

```yaml
name: tunefree

environment:
  sdk: ^3.10.0

dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  flutter_riverpod: ^2.6.1
  go_router: ^16.2.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0
```

Create `./lib/main.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const ProviderScope(child: TuneFreeApp()));
}
```

Create `./lib/app/app.dart`:

```dart
import 'package:flutter/material.dart';

import 'router/app_router.dart';
import 'theme/app_theme.dart';

class TuneFreeApp extends StatelessWidget {
  const TuneFreeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'TuneFree',
      debugShowCheckedModeBanner: false,
      theme: buildTuneFreeTheme(),
      routerConfig: appRouter,
    );
  }
}
```

Create `./lib/app/theme/app_theme.dart`:

```dart
import 'package:flutter/material.dart';

ThemeData buildTuneFreeTheme() {
  const brand = Color(0xFFE94B5B);
  final scheme = ColorScheme.fromSeed(
    seedColor: brand,
    brightness: Brightness.light,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    scaffoldBackgroundColor: const Color(0xFFF5F7FA),
    appBarTheme: const AppBarTheme(
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: brand.withOpacity(0.12),
      labelTextStyle: WidgetStateProperty.all(
        const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
  );
}
```

Create `./lib/app/router/app_router.dart`:

```dart
import 'package:go_router/go_router.dart';

import '../../features/home/presentation/home_page.dart';
import '../../features/library/presentation/library_page.dart';
import '../../features/search/presentation/search_page.dart';
import '../shell/tune_free_shell.dart';

final appRouter = GoRouter(
  initialLocation: '/',
  routes: [
    ShellRoute(
      builder: (context, state, child) => TuneFreeShell(child: child),
      routes: [
        GoRoute(
          path: '/',
          builder: (context, state) => const HomePage(),
        ),
        GoRoute(
          path: '/search',
          builder: (context, state) => const SearchPage(),
        ),
        GoRoute(
          path: '/library',
          builder: (context, state) => const LibraryPage(),
        ),
      ],
    ),
  ],
);
```

Create `./lib/app/shell/tune_free_shell.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class TuneFreeShell extends StatelessWidget {
  const TuneFreeShell({super.key, required this.child});

  final Widget child;

  int _selectedIndex(String path) {
    if (path.startsWith('/search')) return 1;
    if (path.startsWith('/library')) return 2;
    return 0;
  }

  void _onDestinationSelected(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/');
      case 1:
        context.go('/search');
      case 2:
        context.go('/library');
    }
  }

  @override
  Widget build(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;

    return Scaffold(
      body: SafeArea(child: child),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex(path),
        onDestinationSelected: (index) => _onDestinationSelected(context, index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: '首页'),
          NavigationDestination(icon: Icon(Icons.search_rounded), label: '搜索'),
          NavigationDestination(icon: Icon(Icons.library_music_outlined), label: '我的'),
        ],
      ),
    );
  }
}
```

Create `./lib/features/home/presentation/home_page.dart`:

```dart
import 'package:flutter/material.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        'TuneFree',
        style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
      ),
    );
  }
}
```

Create `./lib/features/search/presentation/search_page.dart`:

```dart
import 'package:flutter/material.dart';

class SearchPage extends StatelessWidget {
  const SearchPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        '搜索',
        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
      ),
    );
  }
}
```

Create `./lib/features/library/presentation/library_page.dart`:

```dart
import 'package:flutter/material.dart';

class LibraryPage extends StatelessWidget {
  const LibraryPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        '我的',
        style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
      ),
    );
  }
}
```

Then fetch packages:

```bash
flutter pub get
```

- [ ] **Step 4: Run the smoke test again and verify the new shell passes**

Run:

```bash
flutter test test/app/tune_free_app_test.dart -r expanded
```

Expected: PASS with one widget test.

- [ ] **Step 5: Commit the root replacement slice**

Run:

```bash
git add .gitignore analysis_options.yaml pubspec.yaml pubspec.lock android ios web windows macos linux lib test legacy

git commit -m "$(cat <<'EOF'
feat: replace root with flutter shell
EOF
)"
```

---

### Task 2: Add immutable player state and a deterministic controller

**Files:**
- Modify: `./pubspec.yaml`
- Create: `./lib/features/player/domain/play_mode.dart`
- Create: `./lib/features/player/domain/player_track.dart`
- Create: `./lib/features/player/domain/player_state.dart`
- Create: `./lib/features/player/application/player_engine.dart`
- Create: `./lib/features/player/application/in_memory_player_engine.dart`
- Create: `./lib/features/player/application/player_controller.dart`
- Test: `./test/features/player/application/player_controller_test.dart`

- [ ] **Step 1: Write the failing player controller test**

Create `test/features/player/application/player_controller_test.dart`:

```dart
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/application/player_engine.dart';
import 'package:tunefree/features/player/domain/player_track.dart';

class FakePlayerEngine implements PlayerEngine {
  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();
  int playCalls = 0;
  int pauseCalls = 0;
  Duration? lastSeek;

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  Future<void> load(PlayerTrack track) async {
    _snapshot = _snapshot.copyWith(
      isLoading: false,
      duration: const Duration(minutes: 3, seconds: 12),
      position: Duration.zero,
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
  Future<void> play() async {
    playCalls += 1;
    _snapshot = _snapshot.copyWith(isPlaying: true);
    _controller.add(_snapshot);
  }

  @override
  Future<void> seek(Duration position) async {
    lastSeek = position;
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}

void main() {
  test('openTrack populates state and toggles playback', () async {
    final fakeEngine = FakePlayerEngine();
    final container = ProviderContainer(
      overrides: [playerEngineProvider.overrideWithValue(fakeEngine)],
    );
    addTearDown(container.dispose);

    const track = PlayerTrack(
      id: 'skeleton-track',
      source: 'demo',
      title: 'Player Skeleton',
      artist: 'TuneFree',
    );

    final controller = container.read(playerControllerProvider.notifier);

    await controller.openTrack(track, queue: const [track]);
    await Future<void>.delayed(Duration.zero);

    expect(container.read(playerControllerProvider).currentTrack, track);
    expect(container.read(playerControllerProvider).queue, const [track]);
    expect(container.read(playerControllerProvider).duration, const Duration(minutes: 3, seconds: 12));

    await controller.togglePlayback();
    await Future<void>.delayed(Duration.zero);
    expect(fakeEngine.playCalls, 1);
    expect(container.read(playerControllerProvider).isPlaying, isTrue);

    await controller.seek(const Duration(seconds: 42));
    await Future<void>.delayed(Duration.zero);
    expect(fakeEngine.lastSeek, const Duration(seconds: 42));
    expect(container.read(playerControllerProvider).position, const Duration(seconds: 42));
  });

  test('expand and collapse update full-player state', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);

    final controller = container.read(playerControllerProvider.notifier);

    controller.expand();
    expect(container.read(playerControllerProvider).isExpanded, isTrue);

    controller.collapse();
    expect(container.read(playerControllerProvider).isExpanded, isFalse);
  });
}
```

- [ ] **Step 2: Run the controller test to verify the player layer does not exist yet**

Run:

```bash
flutter test test/features/player/application/player_controller_test.dart -r expanded
```

Expected: FAIL with import errors for `player_controller.dart`, `player_engine.dart`, and `player_track.dart`.

- [ ] **Step 3: Add the player models, engine contract, controller, and in-memory implementation**

Update `./pubspec.yaml` to add the player-slice dependencies:

```yaml
dependencies:
  flutter:
    sdk: flutter
  cupertino_icons: ^1.0.8
  flutter_riverpod: ^2.6.1
  go_router: ^16.2.0
  freezed_annotation: ^3.1.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^6.0.0
  build_runner: ^2.8.0
  freezed: ^3.2.2
```

Create `./lib/features/player/domain/play_mode.dart`:

```dart
enum PlayMode { sequence, loop, shuffle }
```

Create `./lib/features/player/domain/player_track.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

part 'player_track.freezed.dart';

@freezed
class PlayerTrack with _$PlayerTrack {
  const factory PlayerTrack({
    required String id,
    required String source,
    required String title,
    required String artist,
    String? artworkUrl,
    String? streamUrl,
  }) = _PlayerTrack;
}
```

Create `./lib/features/player/domain/player_state.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import 'play_mode.dart';
import 'player_track.dart';

part 'player_state.freezed.dart';

@freezed
class PlayerState with _$PlayerState {
  const factory PlayerState({
    PlayerTrack? currentTrack,
    @Default(<PlayerTrack>[]) List<PlayerTrack> queue,
    @Default(false) bool isPlaying,
    @Default(false) bool isLoading,
    @Default(Duration.zero) Duration position,
    @Default(Duration.zero) Duration duration,
    @Default(PlayMode.sequence) PlayMode playMode,
    @Default(false) bool isExpanded,
  }) = _PlayerState;
}
```

Create `./lib/features/player/application/player_engine.dart`:

```dart
import 'package:freezed_annotation/freezed_annotation.dart';

import '../domain/player_track.dart';

part 'player_engine.freezed.dart';

abstract class PlayerEngine {
  Stream<PlayerEngineSnapshot> get snapshots;
  Future<void> load(PlayerTrack track);
  Future<void> play();
  Future<void> pause();
  Future<void> seek(Duration position);
  Future<void> dispose();
}

@freezed
class PlayerEngineSnapshot with _$PlayerEngineSnapshot {
  const factory PlayerEngineSnapshot({
    @Default(false) bool isLoading,
    @Default(false) bool isPlaying,
    @Default(Duration.zero) Duration position,
    @Default(Duration.zero) Duration duration,
  }) = _PlayerEngineSnapshot;
}
```

Create `./lib/features/player/application/in_memory_player_engine.dart`:

```dart
import 'dart:async';

import '../domain/player_track.dart';
import 'player_engine.dart';

class InMemoryPlayerEngine implements PlayerEngine {
  final _controller = StreamController<PlayerEngineSnapshot>.broadcast();
  PlayerEngineSnapshot _snapshot = const PlayerEngineSnapshot();
  PlayerTrack? _currentTrack;

  @override
  Stream<PlayerEngineSnapshot> get snapshots => _controller.stream;

  @override
  Future<void> load(PlayerTrack track) async {
    _currentTrack = track;
    _snapshot = _snapshot.copyWith(
      isLoading: false,
      isPlaying: false,
      position: Duration.zero,
      duration: const Duration(minutes: 3, seconds: 12),
    );
    _controller.add(_snapshot);
  }

  @override
  Future<void> pause() async {
    _snapshot = _snapshot.copyWith(isPlaying: false);
    _controller.add(_snapshot);
  }

  @override
  Future<void> play() async {
    if (_currentTrack == null) return;
    _snapshot = _snapshot.copyWith(isPlaying: true);
    _controller.add(_snapshot);
  }

  @override
  Future<void> seek(Duration position) async {
    _snapshot = _snapshot.copyWith(position: position);
    _controller.add(_snapshot);
  }

  @override
  Future<void> dispose() async {
    await _controller.close();
  }
}
```

Create `./lib/features/player/application/player_controller.dart`:

```dart
import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../domain/player_state.dart';
import '../domain/player_track.dart';
import 'in_memory_player_engine.dart';
import 'player_engine.dart';

final playerEngineProvider = Provider<PlayerEngine>((ref) {
  final engine = InMemoryPlayerEngine();
  ref.onDispose(engine.dispose);
  return engine;
});

final playerControllerProvider =
    NotifierProvider<PlayerController, PlayerState>(PlayerController.new);

class PlayerController extends Notifier<PlayerState> {
  StreamSubscription<PlayerEngineSnapshot>? _subscription;

  @override
  PlayerState build() {
    final engine = ref.watch(playerEngineProvider);
    _subscription ??= engine.snapshots.listen(_applySnapshot);
    ref.onDispose(() => _subscription?.cancel());
    return const PlayerState();
  }

  Future<void> openTrack(PlayerTrack track, {List<PlayerTrack>? queue}) async {
    state = state.copyWith(
      currentTrack: track,
      queue: queue ?? [track],
      isLoading: true,
      isExpanded: false,
      position: Duration.zero,
    );

    await ref.read(playerEngineProvider).load(track);
  }

  Future<void> togglePlayback() async {
    if (state.currentTrack == null) return;

    if (state.isPlaying) {
      await ref.read(playerEngineProvider).pause();
      return;
    }

    await ref.read(playerEngineProvider).play();
  }

  Future<void> seek(Duration position) {
    return ref.read(playerEngineProvider).seek(position);
  }

  void expand() {
    state = state.copyWith(isExpanded: true);
  }

  void collapse() {
    state = state.copyWith(isExpanded: false);
  }

  void _applySnapshot(PlayerEngineSnapshot snapshot) {
    state = state.copyWith(
      isLoading: snapshot.isLoading,
      isPlaying: snapshot.isPlaying,
      position: snapshot.position,
      duration: snapshot.duration,
    );
  }
}
```

Generate the immutable model code and fetch packages:

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs
```

- [ ] **Step 4: Run the controller test again and verify the player state layer passes**

Run:

```bash
flutter test test/features/player/application/player_controller_test.dart -r expanded
```

Expected: PASS with two tests.

- [ ] **Step 5: Commit the player domain slice**

Run:

```bash
git add pubspec.yaml lib/features/player test/features/player

git commit -m "$(cat <<'EOF'
feat: add flutter player state backbone
EOF
)"
```

---

### Task 3: Render mini/full player surfaces from the shared controller

**Files:**
- Modify: `./lib/app/shell/tune_free_shell.dart`
- Modify: `./lib/features/home/presentation/home_page.dart`
- Create: `./lib/features/player/presentation/widgets/mini_player_bar.dart`
- Create: `./lib/features/player/presentation/widgets/full_player_sheet.dart`
- Test: `./test/features/player/presentation/player_surface_test.dart`

- [ ] **Step 1: Write the failing player surface test**

Create `test/features/player/presentation/player_surface_test.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/app.dart';

void main() {
  testWidgets('demo track opens mini player and full player scaffold', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: TuneFreeApp()));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('mini-player')), findsNothing);

    await tester.tap(find.byKey(const Key('home-demo-track-button')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('mini-player')), findsOneWidget);
    expect(find.text('Player Skeleton'), findsOneWidget);

    await tester.tap(find.byKey(const Key('mini-player')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('full-player')), findsOneWidget);
    expect(find.text('Demo Source'), findsOneWidget);

    await tester.tap(find.byKey(const Key('close-full-player')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('full-player')), findsNothing);
  });
}
```

- [ ] **Step 2: Run the surface test to prove the player UI layer is missing**

Run:

```bash
flutter test test/features/player/presentation/player_surface_test.dart -r expanded
```

Expected: FAIL because `home-demo-track-button`, `mini-player`, and `full-player` do not exist yet.

- [ ] **Step 3: Build the placeholder home action, mini player, full player, and shell overlay**

Replace `./lib/features/home/presentation/home_page.dart` with:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../player/application/player_controller.dart';
import '../../player/domain/player_track.dart';

class HomePage extends ConsumerWidget {
  const HomePage({super.key});

  static const _demoTrack = PlayerTrack(
    id: 'skeleton-track',
    source: 'demo',
    title: 'Player Skeleton',
    artist: 'TuneFree',
  );

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const Text(
          'TuneFree',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 12),
        const Text('Flutter shell ready'),
        const SizedBox(height: 24),
        FilledButton.icon(
          key: const Key('home-demo-track-button'),
          onPressed: () {
            ref.read(playerControllerProvider.notifier).openTrack(
                  _demoTrack,
                  queue: const [_demoTrack],
                );
          },
          icon: const Icon(Icons.play_circle_fill_rounded),
          label: const Text('打开播放器骨架'),
        ),
      ],
    );
  }
}
```

Create `./lib/features/player/presentation/widgets/mini_player_bar.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/player_controller.dart';

class MiniPlayerBar extends ConsumerWidget {
  const MiniPlayerBar({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(playerControllerProvider);
    final track = state.currentTrack;

    if (track == null) {
      return const SizedBox.shrink();
    }

    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Material(
          color: Colors.white,
          elevation: 6,
          borderRadius: BorderRadius.circular(20),
          child: InkWell(
            key: const Key('mini-player'),
            borderRadius: BorderRadius.circular(20),
            onTap: () => ref.read(playerControllerProvider.notifier).expand(),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: Row(
                children: [
                  const CircleAvatar(child: Icon(Icons.music_note_rounded)),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          track.title,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          track.artist,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    key: const Key('mini-player-play-toggle'),
                    onPressed: () {
                      ref.read(playerControllerProvider.notifier).togglePlayback();
                    },
                    icon: Icon(
                      state.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
```

Create `./lib/features/player/presentation/widgets/full_player_sheet.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/player_controller.dart';

class FullPlayerSheet extends ConsumerWidget {
  const FullPlayerSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(playerControllerProvider);
    final track = state.currentTrack;

    if (track == null || !state.isExpanded) {
      return const SizedBox.shrink();
    }

    final durationSeconds = state.duration.inSeconds == 0 ? 1 : state.duration.inSeconds;
    final positionSeconds = state.position.inSeconds.clamp(0, durationSeconds);

    return Positioned.fill(
      child: Material(
        key: const Key('full-player'),
        color: const Color(0xFFF5F7FA),
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Align(
                  alignment: Alignment.topLeft,
                  child: IconButton(
                    key: const Key('close-full-player'),
                    onPressed: () => ref.read(playerControllerProvider.notifier).collapse(),
                    icon: const Icon(Icons.expand_more_rounded),
                  ),
                ),
                const SizedBox(height: 24),
                const Center(
                  child: CircleAvatar(
                    radius: 72,
                    child: Icon(Icons.music_note_rounded, size: 48),
                  ),
                ),
                const SizedBox(height: 32),
                Text(
                  track.title,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  track.artist,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 4),
                const Text('Demo Source'),
                const SizedBox(height: 32),
                Slider(
                  value: positionSeconds.toDouble(),
                  max: durationSeconds.toDouble(),
                  onChanged: (value) {
                    ref.read(playerControllerProvider.notifier).seek(
                          Duration(seconds: value.round()),
                        );
                  },
                ),
                const SizedBox(height: 24),
                Center(
                  child: FilledButton.icon(
                    key: const Key('full-player-play-toggle'),
                    onPressed: () {
                      ref.read(playerControllerProvider.notifier).togglePlayback();
                    },
                    icon: Icon(
                      state.isPlaying ? Icons.pause_rounded : Icons.play_arrow_rounded,
                    ),
                    label: Text(state.isPlaying ? '暂停' : '播放'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
```

Update `./lib/app/shell/tune_free_shell.dart` so the shell hosts the player overlay above the nav bar:

```dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/player/presentation/widgets/full_player_sheet.dart';
import '../../features/player/presentation/widgets/mini_player_bar.dart';

class TuneFreeShell extends StatelessWidget {
  const TuneFreeShell({super.key, required this.child});

  final Widget child;

  int _selectedIndex(String path) {
    if (path.startsWith('/search')) return 1;
    if (path.startsWith('/library')) return 2;
    return 0;
  }

  void _onDestinationSelected(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/');
      case 1:
        context.go('/search');
      case 2:
        context.go('/library');
    }
  }

  @override
  Widget build(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 148),
              child: SafeArea(bottom: false, child: child),
            ),
          ),
          const Positioned(
            left: 0,
            right: 0,
            bottom: 88,
            child: MiniPlayerBar(),
          ),
          const FullPlayerSheet(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex(path),
        onDestinationSelected: (index) => _onDestinationSelected(context, index),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: '首页'),
          NavigationDestination(icon: Icon(Icons.search_rounded), label: '搜索'),
          NavigationDestination(icon: Icon(Icons.library_music_outlined), label: '我的'),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run the surface test, then run the full Flutter verification pass**

Run:

```bash
flutter test test/features/player/presentation/player_surface_test.dart -r expanded
flutter test
flutter analyze
```

Expected:

- the surface test PASSes
- `flutter test` PASSes all three test files
- `flutter analyze` reports `No issues found!`

- [ ] **Step 5: Commit the player UI slice**

Run:

```bash
git add lib/app/shell/tune_free_shell.dart lib/features/home/presentation/home_page.dart lib/features/player test/features/player

git commit -m "$(cat <<'EOF'
feat: add flutter player scaffold surfaces
EOF
)"
```

---

## Manual Smoke Check After Task 3

Run one local shell manually after tests pass:

```bash
flutter run -d chrome
```

Verify this golden path manually:

1. App opens on Home
2. Bottom navigation switches between Home / Search / Library
3. “打开播放器骨架” shows the mini player
4. Tapping the mini player opens the full player
5. Play/pause toggles update the icon state
6. Closing the full player returns to the shell without breaking the mini player

## Follow-on Plans Required

Create separate plans after this one lands:

1. `2026-04-16-home-search-data-migration.md`
2. `2026-04-16-library-and-playlists-migration.md`
3. `2026-04-16-real-audio-engine-and-media-session.md`
4. `2026-04-16-lyrics-downloads-and-platform-polish.md`

## Self-Review

### Spec coverage for this slice

Covered by this plan:

- root replacement with Flutter
- deletion of the old Android/Capacitor shell
- Flutter app shell and navigation
- player domain models
- root-scoped player controller
- mini player and full player scaffold

Deliberately deferred to follow-on plans:

- Home/Search real API migration
- Library/favorites/playlists/settings migration
- real `just_audio` / `audio_service` integration
- lyrics, downloads, and platform-specific polish

### Placeholder scan

No `TODO`, `TBD`, “similar to Task N”, or unspecified “handle appropriately” steps remain.

### Type consistency

The plan uses these names consistently across all tasks:

- `PlayerTrack`
- `PlayerState`
- `PlayerEngine`
- `PlayerEngineSnapshot`
- `playerEngineProvider`
- `playerControllerProvider`
- `MiniPlayerBar`
- `FullPlayerSheet`
