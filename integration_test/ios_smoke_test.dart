import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:tunefree/app/app.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/network/music_api_controller.dart';
import 'package:tunefree/core/network/music_api_settings.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/player/application/player_controller.dart';
import 'package:tunefree/features/player/data/player_download_service.dart';
import 'package:tunefree/features/search/application/search_providers.dart';
import 'package:tunefree/features/search/presentation/search_page.dart';
import 'package:tunefree/main.dart' as app;
import 'package:tunefree/shared/theme/appearance_controller.dart';
import 'package:tunefree/shared/theme/appearance_preferences.dart';

Future<void> waitFor(
  WidgetTester tester,
  bool Function() condition, {
  Duration timeout = const Duration(seconds: 30),
}) async {
  final deadline = DateTime.now().add(timeout);
  while (!condition()) {
    if (DateTime.now().isAfter(deadline)) {
      fail('Timed out waiting for the iOS app.');
    }
    await tester.pump(const Duration(milliseconds: 200));
  }
  await tester.pump(const Duration(milliseconds: 400));
}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  const fixtureBase = String.fromEnvironment('IOS_SMOKE_API_BASE');

  testWidgets(
    'iOS launches, saves sources and plays native and offline audio',
    (tester) async {
      expect(Platform.isIOS, isTrue);
      expect(fixtureBase, isNotEmpty, reason: 'Start tool/ios_api_fixture.py.');
      tester.testTextInput.register();
      addTearDown(tester.testTextInput.unregister);
      app.main();
      await waitFor(
        tester,
        () => find.byType(TuneFreeApp).evaluate().isNotEmpty,
      );
      final container = ProviderScope.containerOf(
        tester.element(find.byType(TuneFreeApp)),
      );
      final api = container.read(musicApiControllerProvider.notifier);
      final appearance = container.read(appearanceControllerProvider);
      final originalApi = await api.ready;
      await appearance.load();
      final originalTheme = appearance.preferences.themeMode;
      addTearDown(() async {
        await container.read(playerControllerProvider.notifier).stop();
        await container
            .read(musicApiControllerProvider.notifier)
            .save(originalApi);
        await appearance.setThemeMode(originalTheme);
      });
      await appearance.setThemeMode(ThemeModeSetting.light);

      // The homepage uses the real upstream service; fixture data is used only
      // below for reproducible source, AVFoundation and file-system checks.
      await waitFor(
        tester,
        () => !container.read(homeControllerProvider).state.listsLoading,
      );
      await binding.takeScreenshot('ios-home');
      await tester.tap(find.byKey(const Key('shell-nav-我的')));
      await waitFor(tester, () => find.text('音源').evaluate().isNotEmpty);
      await tester.tap(find.text('音源'));
      await waitFor(
        tester,
        () =>
            find.byKey(const Key('music-api-url-field')).evaluate().isNotEmpty,
      );
      await tester.pumpAndSettle();
      await binding.takeScreenshot('ios-sources-light');

      await appearance.setThemeMode(ThemeModeSetting.dark);
      await tester.pumpAndSettle();
      expect(
        Theme.of(tester.element(find.byKey(const Key('music-api-url-field'))))
            .brightness,
        Brightness.dark,
      );
      await binding.takeScreenshot('ios-sources-dark');
      await appearance.setThemeMode(ThemeModeSetting.light);
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('music-api-url-field')),
        '$fixtureBase/v1/api.php',
      );
      await tester.tap(find.byKey(const Key('music-api-test-button')));
      await waitFor(
        tester,
        () => find.text('音乐 API 连接成功').evaluate().isNotEmpty,
      );
      expect(
        await api.ready,
        originalApi,
        reason: 'Draft tests must not save.',
      );
      await tester.ensureVisible(
        find.byKey(const Key('playlist-api-url-field')),
      );
      await tester.enterText(
        find.byKey(const Key('playlist-api-url-field')),
        '$fixtureBase/api',
      );
      await tester.ensureVisible(
        find.byKey(const Key('playlist-api-test-button')),
      );
      await tester.tap(find.byKey(const Key('playlist-api-test-button')));
      await waitFor(
        tester,
        () => find.text('歌单 API 连接成功').evaluate().isNotEmpty,
      );
      await tester.ensureVisible(
        find.byKey(const Key('music-api-save-button')),
      );
      await tester.tap(find.byKey(const Key('music-api-save-button')));
      await waitFor(tester, () => api.settings.usesCustomMusicApi);
      expect(api.settings.requestMode, MusicApiRequestMode.gdSignedPost);
      final saved = api.settings;
      container.invalidate(musicApiControllerProvider);
      final restoredApi = container.read(musicApiControllerProvider.notifier);
      expect(await restoredApi.ready, saved);
      // Wait for the save feedback to leave the bottom navigation unobstructed.
      await waitFor(tester, () => find.byType(SnackBar).evaluate().isEmpty);
      await binding.takeScreenshot('ios-source-saved');

      await tester.tap(find.byKey(const Key('shell-nav-搜索')));
      await tester.pump(const Duration(milliseconds: 700));
      await binding.takeScreenshot('ios-search-navigation');
      await waitFor(
        tester,
        () => find.byType(SearchPage).evaluate().isNotEmpty,
      );
      await tester.enterText(find.byType(TextField).first, 'iOS 音源测试');
      await tester.pump(const Duration(milliseconds: 100));
      expect(container.read(searchControllerProvider).state.query, 'iOS 音源测试');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await waitFor(
        tester,
        () => container.read(searchControllerProvider).state.results.isNotEmpty,
      );
      final song = container.read(searchControllerProvider).state.results.first;
      expect(song.name, 'iOS 音源测试 A');
      await binding.takeScreenshot('ios-search');
      await tester.tap(find.text(song.name).first);
      await waitFor(
        tester,
        () =>
            container.read(playerControllerProvider).isPlaying &&
            container.read(playerControllerProvider).position >
                const Duration(milliseconds: 500),
      );
      expect(
        container.read(playerControllerProvider).duration,
        greaterThan(const Duration(seconds: 10)),
      );
      final player = container.read(playerControllerProvider.notifier);
      await player.pause();
      await waitFor(
        tester,
        () => !container.read(playerControllerProvider).isPlaying,
      );
      player.expand();
      await waitFor(
        tester,
        () => find.byKey(const Key('full-player')).evaluate().isNotEmpty,
      );
      await tester.pumpAndSettle();
      await binding.takeScreenshot('ios-player');
      player.setShowLyrics(true);
      await waitFor(
        tester,
        () =>
            find.byKey(const Key('player-lyrics-panel')).evaluate().isNotEmpty,
      );
      await tester.pumpAndSettle();
      await binding.takeScreenshot('ios-lyrics');

      final download = await container
          .read(playerDownloadServiceProvider)
          .downloadSong(song, AudioQuality.k320);
      expect(await File(download.filePath).length(), greaterThan(1000));
      await player.stop();
      await player.playSong(song);
      await waitFor(
        tester,
        () => container.read(playerControllerProvider).isPlaying,
      );
      expect(
        container.read(playerControllerProvider).currentSong?.url,
        startsWith('file:'),
        reason: 'A saved download must play from the iOS app sandbox.',
      );
      await player.pause();
      player.collapse();
      await tester.pump(const Duration(milliseconds: 400));
      await tester.tap(find.byKey(const Key('shell-nav-我的')));
      await waitFor(tester, () => find.text('关于').evaluate().isNotEmpty);
      await tester.tap(find.text('关于'));
      await tester.pumpAndSettle();
      expect(find.text('发布记录'), findsOneWidget);
      expect(find.text('Android 离线体验'), findsNothing);
      await binding.takeScreenshot('ios-about');
      binding.reportData!['nativePlayback'] = true;
      binding.reportData!['offlinePlayback'] = true;
      binding.reportData!['persistedSources'] = true;
    },
    timeout: const Timeout(Duration(minutes: 4)),
  );
}
