import 'package:material_ui/material_ui.dart';

/// 主题模式，与 Tauri 侧 `ThemeMode` 一致。
enum ThemeModeSetting { light, dark, system }

/// 显示模式：跟随系统 / 始终浅色 / 始终深色。
extension ThemeModeSettingX on ThemeModeSetting {
  String get storageValue => switch (this) {
    ThemeModeSetting.light => 'light',
    ThemeModeSetting.dark => 'dark',
    ThemeModeSetting.system => 'system',
  };

  String get label => switch (this) {
    ThemeModeSetting.light => '浅色',
    ThemeModeSetting.dark => '深色',
    ThemeModeSetting.system => '跟随系统',
  };

  ThemeMode get materialMode => switch (this) {
    ThemeModeSetting.light => ThemeMode.light,
    ThemeModeSetting.dark => ThemeMode.dark,
    ThemeModeSetting.system => ThemeMode.system,
  };
}

const String kDefaultAccentHex = '#FA233B';
const int kDefaultLyricSize = 22;
const int kMinLyricSize = 14;
const int kMaxLyricSize = 36;

/// 歌词时间轴偏移。正值 = 歌词整体**推迟**出现（唱到了才亮），
/// 负值 = 提前。范围与 Tauri 的 `setLyricOffsetSeconds` 一致（±10 秒），
/// 但 Tauri 那边只有状态、没有落盘也没有 UI —— 这里两样都补上了。
const int kDefaultLyricOffsetMs = 0;
const int kMinLyricOffsetMs = -10000;
const int kMaxLyricOffsetMs = 10000;

/// 歌词字体。**刻意与 Tauri 不是同一份列表**：那份是桌面字体栈
/// （PingFang SC / Microsoft YaHei / SimSun / STXihei），Android 上大多并不存在，
/// 照抄过去只会静默回退到默认字体。这里改用各平台真正可能命中的家族，
/// 并且 Flutter 里字体栈是 family + fallback 两个字段，不是一条 CSS 字符串。
/// 不打包字体 asset —— 那会给 APK 增加几 MB，而这里要的只是「能生效的选择」。
final class LyricFontOption {
  const LyricFontOption(
    this.label,
    this.id, {
    this.family,
    this.fallback = const <String>[],
  });

  final String label;

  /// 落盘用的稳定标识，与 [family] 解耦（默认项根本没有 family）。
  final String id;

  /// `null` 表示**不指定字体**，交给平台。「系统默认」必须是这个语义：
  /// 指定一个不存在的家族名再让引擎回退回来，等于白白多绕一层，
  /// 而且会让本来稳定的排版结果变得不可预期。
  final String? family;

  final List<String> fallback;

  TextStyle apply(TextStyle style) {
    final resolved = family;
    if (resolved == null) {
      return style;
    }
    return style.copyWith(fontFamily: resolved, fontFamilyFallback: fallback);
  }
}

const List<LyricFontOption> kLyricFontOptions = <LyricFontOption>[
  LyricFontOption('系统默认', 'system'),
  LyricFontOption(
    '思源黑体',
    'noto-sans-cjk',
    family: 'Noto Sans CJK SC',
    fallback: <String>['Source Han Sans SC', 'sans-serif'],
  ),
  LyricFontOption(
    '思源宋体',
    'noto-serif-cjk',
    family: 'Noto Serif CJK SC',
    fallback: <String>['Source Han Serif SC', 'serif'],
  ),
  LyricFontOption(
    '无衬线',
    'sans-serif',
    family: 'sans-serif',
    fallback: <String>['Roboto'],
  ),
  LyricFontOption(
    '衬线',
    'serif',
    family: 'serif',
    fallback: <String>['Noto Serif'],
  ),
];

/// 预设强调色。与 Tauri 的 `PRESET_COLORS` 是同一份 12 色。
final class AccentPreset {
  const AccentPreset(this.label, this.hex, this.color);

  final String label;
  final String hex;
  final Color color;
}

const List<AccentPreset> kAccentPresets = <AccentPreset>[
  AccentPreset('玫瑰红', '#FA233B', Color(0xFFFA233B)),
  AccentPreset('樱花粉', '#FF2D55', Color(0xFFFF2D55)),
  AccentPreset('珊瑚橙', '#FF6B35', Color(0xFFFF6B35)),
  AccentPreset('活力橙', '#FF9500', Color(0xFFFF9500)),
  AccentPreset('柠檬黄', '#FFCC00', Color(0xFFFFCC00)),
  AccentPreset('极光绿', '#34C759', Color(0xFF34C759)),
  AccentPreset('薄荷青', '#00C7BE', Color(0xFF00C7BE)),
  AccentPreset('星海蓝', '#007AFF', Color(0xFF007AFF)),
  AccentPreset('靛蓝', '#5856D6', Color(0xFF5856D6)),
  AccentPreset('丁香紫', '#AF52DE', Color(0xFFAF52DE)),
  AccentPreset('玫瑰金', '#BF5959', Color(0xFFBF5959)),
  AccentPreset('石墨灰', '#8E8E93', Color(0xFF8E8E93)),
];

/// 用户的可外观偏好。对应 Tauri 的 `ThemePreferences`。
@immutable
final class AppearancePreferences {
  const AppearancePreferences({
    this.themeMode = ThemeModeSetting.system,
    this.accentHex = kDefaultAccentHex,
    this.lyricSize = kDefaultLyricSize,
    this.lyricFontId = 'system',
    this.lyricOffsetMs = kDefaultLyricOffsetMs,
  });

  final ThemeModeSetting themeMode;
  final String accentHex;
  final int lyricSize;
  final String lyricFontId;
  final int lyricOffsetMs;

  Color get accent => parseHexColor(accentHex);

  /// 歌词偏移的时长形式，供播放位置换算用。
  Duration get lyricOffset => Duration(milliseconds: lyricOffsetMs);

  LyricFontOption get lyricFont => kLyricFontOptions.firstWhere(
    (option) => option.id == lyricFontId,
    orElse: () => kLyricFontOptions.first,
  );

  AppearancePreferences copyWith({
    ThemeModeSetting? themeMode,
    String? accentHex,
    int? lyricSize,
    String? lyricFontId,
    int? lyricOffsetMs,
  }) {
    return AppearancePreferences(
      themeMode: themeMode ?? this.themeMode,
      accentHex: accentHex ?? this.accentHex,
      lyricSize: lyricSize ?? this.lyricSize,
      lyricFontId: lyricFontId ?? this.lyricFontId,
      lyricOffsetMs: lyricOffsetMs ?? this.lyricOffsetMs,
    );
  }

  @override
  bool operator ==(Object other) =>
      other is AppearancePreferences &&
      other.themeMode == themeMode &&
      other.accentHex == accentHex &&
      other.lyricSize == lyricSize &&
      other.lyricFontId == lyricFontId &&
      other.lyricOffsetMs == lyricOffsetMs;

  @override
  int get hashCode =>
      Object.hash(themeMode, accentHex, lyricSize, lyricFontId, lyricOffsetMs);
}

// ─── 归一化：所有读入都必须过一遍，localStorage 可能被改坏或来自旧版本 ───

final RegExp _hexPattern = RegExp(r'^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$');

/// 旧版本用过的命名颜色。
const Map<String, String> _legacyAccentNames = <String, String>{
  'red': '#FA233B',
  'blue': '#007AFF',
  'green': '#34C759',
  'purple': '#AF52DE',
  'orange': '#FF9500',
};

Color parseHexColor(String hex) {
  final normalized = normalizeAccentHex(hex);
  final value = int.parse(normalized.substring(1), radix: 16);
  return Color(0xFF000000 | value);
}

String normalizeAccentHex(Object? value) {
  if (value is String) {
    final legacy = _legacyAccentNames[value];
    if (legacy != null) {
      return legacy;
    }
    final trimmed = value.trim();
    if (_hexPattern.hasMatch(trimmed)) {
      var h = trimmed.startsWith('#') ? trimmed : '#$trimmed';
      if (h.length == 4) {
        // #abc → #aabbcc
        h = '#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}';
      }
      return h.toUpperCase();
    }
  }
  return kDefaultAccentHex;
}

ThemeModeSetting normalizeThemeMode(Object? value) {
  for (final mode in ThemeModeSetting.values) {
    if (mode.storageValue == value) {
      return mode;
    }
  }
  return ThemeModeSetting.system;
}

int clampLyricSize(Object? value) {
  final parsed = value is int ? value : int.tryParse('${value ?? ''}');
  if (parsed == null) {
    return kDefaultLyricSize;
  }
  return parsed.clamp(kMinLyricSize, kMaxLyricSize);
}

String normalizeLyricFontId(Object? value) {
  for (final option in kLyricFontOptions) {
    if (option.id == value) {
      return option.id;
    }
  }
  return kLyricFontOptions.first.id;
}

int clampLyricOffsetMs(Object? value) {
  final parsed = value is int ? value : int.tryParse('${value ?? ''}');
  if (parsed == null) {
    return kDefaultLyricOffsetMs;
  }
  return parsed.clamp(kMinLyricOffsetMs, kMaxLyricOffsetMs);
}

/// 把毫秒偏移渲染成带上符号的秒数，例如 `+1.2s` / `-0.5s` / `0.0s`。
///
/// 符号必须显式写出来：只显示 `1.2s` 看不出是提前还是推迟。
String formatLyricOffset(int milliseconds) {
  final seconds = milliseconds / 1000;
  final sign = seconds > 0 ? '+' : (seconds < 0 ? '-' : '');
  return '$sign${seconds.abs().toStringAsFixed(1)}s';
}

/// 暗色下把强调色提亮一档，否则深色背景上的品牌色会发闷。
/// 移植自 Tauri 的 `lightenForDark`：HSL 亮度 +8 个百分点，封顶 72%。
Color accentForDark(Color base) {
  final hsl = HSLColor.fromColor(base);
  final lightened = hsl.withLightness(
    ((hsl.lightness * 100) + 8).clamp(0, 72) / 100,
  );
  return lightened.toColor();
}

/// 当前是否该用暗色。
bool resolveIsDark(ThemeModeSetting mode, {required bool systemPrefersDark}) {
  return switch (mode) {
    ThemeModeSetting.dark => true,
    ThemeModeSetting.light => false,
    ThemeModeSetting.system => systemPrefersDark,
  };
}
