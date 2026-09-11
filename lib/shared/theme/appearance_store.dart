import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'appearance_preferences.dart';

/// 外观偏好的持久化。键名与 Tauri 侧完全一致，便于两边对照排查。
abstract class AppearanceStore {
  const AppearanceStore();

  Future<AppearancePreferences> load();

  Future<void> save(AppearancePreferences preferences);
}

const String _kModeKey = 'tunefree_theme_mode';
const String _kColorKey = 'tunefree_theme_color';
const String _kLyricSizeKey = 'tunefree_lyric_size';
const String _kLyricFontKey = 'tunefree_lyric_font';

final class SharedPreferencesAppearanceStore extends AppearanceStore {
  const SharedPreferencesAppearanceStore();

  @override
  Future<AppearancePreferences> load() async {
    // 外观偏好是纯装饰性的：读不到就用默认值，绝不能因此让 App 起不来。
    // 测试环境下没有 mock SharedPreferences 时会走这条分支。
    try {
      final prefs = await SharedPreferences.getInstance();
      // 每个值都过归一化：这些键可能被改坏，也可能来自旧版本。
      return AppearancePreferences(
        themeMode: normalizeThemeMode(prefs.getString(_kModeKey)),
        accentHex: normalizeAccentHex(prefs.getString(_kColorKey)),
        lyricSize: clampLyricSize(prefs.getInt(_kLyricSizeKey)),
        lyricFontId: normalizeLyricFontId(prefs.getString(_kLyricFontKey)),
      );
    } catch (error) {
      debugPrint('外观偏好读取失败，回退默认值: $error');
      return const AppearancePreferences();
    }
  }

  @override
  Future<void> save(AppearancePreferences preferences) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_kModeKey, preferences.themeMode.storageValue);
      await prefs.setString(_kColorKey, preferences.accentHex);
      await prefs.setInt(_kLyricSizeKey, preferences.lyricSize);
      await prefs.setString(_kLyricFontKey, preferences.lyricFontId);
    } catch (error) {
      // 存不下去只影响「下次启动还记得」，不该让当前这次操作失败。
      debugPrint('外观偏好写入失败: $error');
    }
  }
}

/// 内存实现，供测试注入。
final class InMemoryAppearanceStore extends AppearanceStore {
  InMemoryAppearanceStore([this._preferences = const AppearancePreferences()]);

  AppearancePreferences _preferences;

  @override
  Future<AppearancePreferences> load() async => _preferences;

  @override
  Future<void> save(AppearancePreferences preferences) async {
    _preferences = preferences;
  }
}
