import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3 把 ChangeNotifierProvider 移出了主流出口，只在 legacy.dart 里提供。
import 'package:flutter_riverpod/legacy.dart';

import 'appearance_preferences.dart';
import 'appearance_store.dart';

final appearanceStoreProvider = Provider<AppearanceStore>((ref) {
  return const SharedPreferencesAppearanceStore();
});

/// 外观偏好的唯一真相源。
///
/// 沿用仓库既有写法（见 `library_controller.dart`）：抽象 store + ChangeNotifier
/// 控制器 + ChangeNotifierProvider，provider 体内即时 load()。
final appearanceControllerProvider =
    ChangeNotifierProvider<AppearanceController>((ref) {
      final controller = AppearanceController(
        store: ref.watch(appearanceStoreProvider),
      );
      controller.load();
      return controller;
    });

final class AppearanceController extends ChangeNotifier {
  AppearanceController({required AppearanceStore store}) : _store = store;

  final AppearanceStore _store;

  AppearancePreferences _preferences = const AppearancePreferences();
  AppearancePreferences get preferences => _preferences;

  Future<void> load() async {
    _preferences = await _store.load();
    notifyListeners();
  }

  Future<void> setThemeMode(ThemeModeSetting value) =>
      _update(_preferences.copyWith(themeMode: value));

  Future<void> setAccentHex(String value) =>
      _update(_preferences.copyWith(accentHex: normalizeAccentHex(value)));

  Future<void> setLyricSize(int value) =>
      _update(_preferences.copyWith(lyricSize: clampLyricSize(value)));

  Future<void> setLyricFontId(String value) => _update(
    _preferences.copyWith(lyricFontId: normalizeLyricFontId(value)),
  );

  Future<void> _update(AppearancePreferences next) async {
    if (next == _preferences) {
      return;
    }
    _preferences = next;
    notifyListeners();
    await _store.save(next);
  }
}
