import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/shared/theme/appearance_controller.dart';
import 'package:tunefree/shared/theme/appearance_preferences.dart';
import 'package:tunefree/shared/theme/appearance_store.dart';

void main() {
  group('normalizeThemeMode', () {
    test('accepts the stored values', () {
      expect(normalizeThemeMode('light'), ThemeModeSetting.light);
      expect(normalizeThemeMode('dark'), ThemeModeSetting.dark);
      expect(normalizeThemeMode('system'), ThemeModeSetting.system);
    });

    test('falls back to system for anything else', () {
      // 这些值可能来自被改坏的偏好，或来自旧版本。
      expect(normalizeThemeMode(null), ThemeModeSetting.system);
      expect(normalizeThemeMode('DARK'), ThemeModeSetting.system);
      expect(normalizeThemeMode(42), ThemeModeSetting.system);
    });
  });

  group('normalizeAccentHex', () {
    test('keeps a valid 6-digit hex and upper-cases it', () {
      expect(normalizeAccentHex('#007aff'), '#007AFF');
      expect(normalizeAccentHex('007AFF'), '#007AFF');
    });

    test('expands 3-digit shorthand', () {
      expect(normalizeAccentHex('#abc'), '#AABBCC');
    });

    test('maps the legacy named colors', () {
      expect(normalizeAccentHex('blue'), '#007AFF');
      expect(normalizeAccentHex('purple'), '#AF52DE');
    });

    test('falls back to the default for junk', () {
      expect(normalizeAccentHex('not-a-color'), kDefaultAccentHex);
      expect(normalizeAccentHex(null), kDefaultAccentHex);
      expect(normalizeAccentHex('#12345'), kDefaultAccentHex);
    });
  });

  test('clampLyricSize keeps the size inside 14..36', () {
    expect(clampLyricSize(22), 22);
    expect(clampLyricSize(1), kMinLyricSize);
    expect(clampLyricSize(999), kMaxLyricSize);
    expect(clampLyricSize('30'), 30);
    expect(clampLyricSize('junk'), kDefaultLyricSize);
    expect(clampLyricSize(null), kDefaultLyricSize);
  });

  test('normalizeLyricFontId rejects fonts outside the whitelist', () {
    expect(normalizeLyricFontId('sans-serif'), 'sans-serif');
    // 不在白名单里的值会回退，避免任意字符串被当成字体名用。
    expect(normalizeLyricFontId('Comic Sans MS'), kLyricFontOptions.first.id);
    expect(normalizeLyricFontId(null), kLyricFontOptions.first.id);
  });

  test('clampLyricOffsetMs keeps the offset inside ±10s', () {
    expect(clampLyricOffsetMs(0), 0);
    expect(clampLyricOffsetMs(2500), 2500);
    expect(clampLyricOffsetMs(-2500), -2500);
    expect(clampLyricOffsetMs(999999), kMaxLyricOffsetMs);
    expect(clampLyricOffsetMs(-999999), kMinLyricOffsetMs);
    expect(clampLyricOffsetMs('-1000'), -1000);
    expect(clampLyricOffsetMs('junk'), kDefaultLyricOffsetMs);
    expect(clampLyricOffsetMs(null), kDefaultLyricOffsetMs);
  });

  test('formatLyricOffset always spells out the sign', () {
    expect(formatLyricOffset(0), '0.0s');
    expect(formatLyricOffset(1200), '+1.2s');
    expect(formatLyricOffset(-500), '-0.5s');
    expect(formatLyricOffset(-10000), '-10.0s');
  });

  test('the lyric offset survives a save and reload', () async {
    final store = InMemoryAppearanceStore();
    final controller = AppearanceController(store: store);
    await controller.load();

    await controller.setLyricOffsetMs(1800);
    expect(controller.preferences.lyricOffsetMs, 1800);
    expect(
      controller.preferences.lyricOffset,
      const Duration(milliseconds: 1800),
    );

    // 越界值也要先被夹住再落盘。
    await controller.setLyricOffsetMs(60000);
    expect((await store.load()).lyricOffsetMs, kMaxLyricOffsetMs);
  });

  test('accentForDark lightens the accent so it stays legible on dark', () {
    const base = Color(0xFFFA233B);
    final lifted = accentForDark(base);
    expect(lifted.computeLuminance(), greaterThan(base.computeLuminance()));
  });

  test('resolveIsDark follows the mode, with system deferring to the OS', () {
    expect(
      resolveIsDark(ThemeModeSetting.dark, systemPrefersDark: false),
      isTrue,
    );
    expect(
      resolveIsDark(ThemeModeSetting.light, systemPrefersDark: true),
      isFalse,
    );
    expect(
      resolveIsDark(ThemeModeSetting.system, systemPrefersDark: true),
      isTrue,
    );
    expect(
      resolveIsDark(ThemeModeSetting.system, systemPrefersDark: false),
      isFalse,
    );
  });

  test('controller loads from the store and persists every change', () async {
    final store = InMemoryAppearanceStore(
      const AppearancePreferences(
        themeMode: ThemeModeSetting.dark,
        accentHex: '#007AFF',
        lyricSize: 30,
        lyricFontId: 'sans-serif',
      ),
    );
    final controller = AppearanceController(store: store);
    await controller.load();

    expect(controller.preferences.themeMode, ThemeModeSetting.dark);
    expect(controller.preferences.accentHex, '#007AFF');
    expect(controller.preferences.lyricSize, 30);

    var notifications = 0;
    controller.addListener(() => notifications += 1);

    await controller.setThemeMode(ThemeModeSetting.light);
    await controller.setAccentHex('#34C759');
    await controller.setLyricSize(18);
    await controller.setLyricFontId('serif');

    expect(notifications, 4);
    final reloaded = await store.load();
    expect(reloaded.themeMode, ThemeModeSetting.light);
    expect(reloaded.accentHex, '#34C759');
    expect(reloaded.lyricSize, 18);
    expect(reloaded.lyricFontId, 'serif');
  });

  test('controller does not notify when the value is unchanged', () async {
    final store = InMemoryAppearanceStore(
      const AppearancePreferences(accentHex: '#007AFF'),
    );
    final controller = AppearanceController(store: store);
    await controller.load();

    var notifications = 0;
    controller.addListener(() => notifications += 1);
    await controller.setAccentHex('#007aff');

    expect(notifications, 0);
  });
}
