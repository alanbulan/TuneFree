import 'package:material_ui/material_ui.dart';

import '../../shared/theme/appearance_preferences.dart';
import '../../shared/theme/tune_free_palette.dart';

const Color _dangerLight = Color(0xFFFA233B);

/// 按亮度与强调色构建主题。
///
/// 强调色走 `ColorScheme` 的槽位，Material 组件（按钮、滑块、徽标、IconButton）
/// 会自动跟随；`ColorScheme` 表达不了的令牌（频谱柱、玻璃面、歌词三色、输入填充）
/// 放进 `TuneFreeColors` 扩展，用 `TuneFreeColors.of(context)` 取。
///
/// 暗色下强调色会先提亮一档，否则深色底上的品牌色会发闷。
ThemeData buildTuneFreeTheme({
  required Brightness brightness,
  required Color accent,
}) {
  final isDark = brightness == Brightness.dark;
  final effectiveAccent = isDark ? accentForDark(accent) : accent;
  final danger = isDark ? accentForDark(_dangerLight) : _dangerLight;
  final colors = TuneFreeColors.forBrightness(
    brightness,
    accent: effectiveAccent,
  );
  final scheme = ColorScheme.fromSeed(
    seedColor: effectiveAccent,
    brightness: brightness,
  );

  return ThemeData(
    brightness: brightness,
    colorScheme: scheme.copyWith(
      primary: effectiveAccent,
      surface: colors.surface,
      onSurface: colors.textPrimary,
      error: danger,
    ),
    scaffoldBackgroundColor: colors.background,
    extensions: <ThemeExtension<dynamic>>[colors],
    appBarTheme: AppBarTheme(
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
      backgroundColor: colors.background,
      foregroundColor: colors.textPrimary,
    ),
    // 以下这些主题块以前是缺的，于是按钮/滑块的配色只能靠 ColorScheme 兜底，
    // 换强调色时它们并不都跟着走。这里补齐。
    sliderTheme: SliderThemeData(
      activeTrackColor: effectiveAccent,
      thumbColor: effectiveAccent,
      inactiveTrackColor: colors.separator,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: effectiveAccent,
        foregroundColor: Colors.white,
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: colors.textPrimary),
    ),
    badgeTheme: BadgeThemeData(
      backgroundColor: effectiveAccent,
      textColor: Colors.white,
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: colors.surface,
      modalBackgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: colors.surface,
      surfaceTintColor: Colors.transparent,
    ),
    dividerTheme: DividerThemeData(color: colors.separator),
  );
}
