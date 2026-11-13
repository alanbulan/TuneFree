import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/core/network/music_api_controller.dart';
import 'package:tunefree/core/network/music_api_settings.dart';
import 'package:tunefree/core/network/music_api_store.dart';

final class _DelayedStore implements MusicApiStore {
  final loaded = Completer<MusicApiSettings>();
  bool failSave = false;

  @override
  Future<MusicApiSettings> load() => loaded.future;

  @override
  Future<void> save(MusicApiSettings settings) async {
    if (failSave) {
      throw StateError('storage unavailable');
    }
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('validates URLs and preserves path and repeated query parameters', () {
    for (final invalid in [
      'music.example/api.php',
      'file:///etc/passwd',
      'https://',
      'https://music.example/api.php#fragment',
      'https://user:password@music.example/api.php',
      'http://localhost:0/api.php',
      'http://localhost:65536/api.php',
      'https://music .example/api.php',
    ]) {
      expect(validateMusicApiUrl(invalid), isNotNull, reason: invalid);
    }
    final settings = MusicApiSettings.fromInput(
      musicApiBase: ' https://music.example/v2/api.php?tag=a&tag=b&key=demo ',
      playlistApiBase: 'http://192.168.1.10:8080/api///?key=demo',
      requestMode: MusicApiRequestMode.compatibleGet,
    );
    expect(
      settings.musicApiBase,
      'https://music.example/v2/api.php?tag=a&tag=b&key=demo',
    );
    expect(settings.playlistApiBase, 'http://192.168.1.10:8080/api?key=demo');
    expect(settings.usesCustomMusicApi, isTrue);
    expect(MusicApiSettings.fromJson(settings.toJson()), settings);
  });

  test(
    'empty input restores defaults and damaged stored fields are ignored',
    () {
      expect(
        MusicApiSettings.fromInput(
          musicApiBase: ' ',
          playlistApiBase: '',
          requestMode: MusicApiRequestMode.gdSignedPost,
        ),
        const MusicApiSettings(),
      );
      expect(
        MusicApiSettings.fromJson({
          'musicApiBase': 'javascript:alert(1)',
          'playlistApiBase': 42,
          'requestMode': 'unknown',
        }),
        const MusicApiSettings(),
      );
    },
  );

  test(
    'API settings survive a new controller and reset is persisted',
    () async {
      SharedPreferences.setMockInitialValues({});
      final store = SharedPreferencesMusicApiStore();
      final controller = MusicApiController(store: store);
      addTearDown(controller.dispose);
      const settings = MusicApiSettings(
        musicApiBase: 'https://music.example/api.php?key=demo',
        playlistApiBase: 'https://playlist.example/api',
        requestMode: MusicApiRequestMode.compatibleGet,
      );
      await controller.save(settings);
      final restarted = MusicApiController(
        store: SharedPreferencesMusicApiStore(),
      );
      addTearDown(restarted.dispose);
      expect(await restarted.ready, settings);
      await restarted.save(const MusicApiSettings());
      expect(await store.load(), const MusicApiSettings());
      final preferences = await SharedPreferences.getInstance();
      expect(
        jsonDecode(
          preferences.getString(SharedPreferencesMusicApiStore.storageKey)!,
        ),
        const MusicApiSettings().toJson(),
      );
    },
  );

  test(
    'saving waits for hydration and a failed save keeps active settings',
    () async {
      final store = _DelayedStore();
      final controller = MusicApiController(store: store);
      addTearDown(controller.dispose);
      const old = MusicApiSettings(musicApiBase: 'https://old.example/api.php');
      const next = MusicApiSettings(
        musicApiBase: 'https://new.example/api.php',
      );
      final save = controller.save(next);
      expect(controller.isLoaded, isFalse);
      store.loaded.complete(old);
      await save;
      expect(controller.settings, next);
      store.failSave = true;
      await expectLater(controller.save(old), throwsStateError);
      expect(controller.settings, next);
    },
  );

  test('controller disposal during loading is safe', () async {
    final store = _DelayedStore();
    final controller = MusicApiController(store: store);
    final loading = controller.load();
    controller.dispose();
    store.loaded.complete(const MusicApiSettings());
    await loading;
  });
}
