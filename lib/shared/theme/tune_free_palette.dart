import 'package:material_ui/material_ui.dart';

/// 浅色令牌。
///
/// **保留这个类是为了兼容**：现有代码里的 `TuneFreePalette.xxx` 仍然有效，语义不变，
/// 所以漏改的地方在浅色下不会出错，只是不跟随深色。
/// 新代码请用 `TuneFreeColors.of(context)` —— 它会跟着主题走。
final class TuneFreePalette {
  static const background = Color(0xFFF2F2F7);
  static const surface = Colors.white;
  static const accent = Color(0xFFFA233B);
  static const textPrimary = Color(0xFF000000);
  static const textSecondary = Color(0xFF8E8E93);
  static const separator = Color(0xFFC6C6C8);
  static const border = Color(0xFFE5E5EA);
}

/// 随主题变化的一整套颜色令牌。
///
/// 用 `ThemeExtension` 而不是自建 `InheritedWidget`，关键原因是**底部弹窗与对话框
/// 在独立的 route 子树里构建**：本项目有 4 个 sheet，`InheritedWidget` 够不到它们，
/// 而 `Theme.of(context)` 能。暗色的表面色值取自 Tauri 的 tokens.css，保持一致。
///
/// 后半段那些令牌（textTertiary 等）来自 `lib/` 里反复出现的字面量 —— 这些灰阶
/// 事实上构成了一套没有名字的第二调色板。它们的浅色值与原字面量**逐位相同**，
/// 所以浅色外观不变，只是从此能跟随主题。
@immutable
final class TuneFreeColors extends ThemeExtension<TuneFreeColors> {
  const TuneFreeColors({
    required this.background,
    required this.surface,
    required this.textPrimary,
    required this.textSecondary,
    required this.separator,
    required this.border,
    required this.accent,
    required this.accentSoft,
    required this.visualizerBar,
    required this.glassSurface,
    required this.glassBorder,
    required this.lyricActive,
    required this.lyricInactive,
    required this.lyricTranslation,
    required this.inputFill,
    required this.placeholderFill,
    required this.textTertiary,
    required this.textMuted,
    required this.textSubtle,
    required this.fillSubtle,
    required this.fillFaint,
    required this.fillMuted,
    required this.fillPanel,
    required this.borderSubtle,
    required this.danger,
    required this.textStrong,
  });

  final Color background;
  final Color surface;
  final Color textPrimary;
  final Color textSecondary;
  final Color separator;
  final Color border;

  /// 强调色。用户可在设置里更换。
  final Color accent;

  /// 强调色的低透明度底，用于徽标/选中态背景。
  final Color accentSoft;

  /// 频谱柱：浅色下是深色，深色下必须反过来，否则整片看不见。
  final Color visualizerBar;

  final Color glassSurface;
  final Color glassBorder;
  final Color lyricActive;
  final Color lyricInactive;
  final Color lyricTranslation;

  /// 输入框底色。
  final Color inputFill;

  /// 封面占位 / 次级填充块。
  final Color placeholderFill;

  /// 弱化文字（原 0xFF9CA3AF）。
  final Color textTertiary;

  /// 次级文字（原 0xFF6B7280）。
  final Color textMuted;

  /// 更弱的文字（原 0xFF8B8B95）。
  final Color textSubtle;

  /// 浅填充（原 0xFFF3F4F6）。
  final Color fillSubtle;

  /// 极浅填充（原 0xFFF9FAFB）。
  final Color fillFaint;

  /// 略带蓝的浅填充（原 0xFFF5F7FA）。
  final Color fillMuted;

  /// 面板填充（原 0xFFF0F1F5）。
  final Color fillPanel;

  /// 细边框（原 0xFFE5E7EB）。
  final Color borderSubtle;

  /// 危险 / 错误色（原 0xFFDC2626）。
  final Color danger;

  /// 强调文字（原 0xFF111111）。
  ///
  /// 与 [textPrimary] 分开：浅色下 textPrimary 是纯黑，而这个是 #111111，
  /// 用在「浅填充上的选中态」这类强调位置。混为一谈会让浅色外观发生
  /// 肉眼可见之外、却能被测试抓住的变化。
  final Color textStrong;

  /// 取不到扩展时（例如控件不在 MaterialApp 之下）退化为浅色。
  static TuneFreeColors of(BuildContext context) =>
      Theme.of(context).extension<TuneFreeColors>() ?? TuneFreeColors.light();

  static TuneFreeColors forBrightness(
    Brightness brightness, {
    required Color accent,
  }) => brightness == Brightness.dark
      ? TuneFreeColors.dark(accent: accent)
      : TuneFreeColors.light(accent: accent);

  factory TuneFreeColors.light({Color accent = const Color(0xFFFA233B)}) {
    return TuneFreeColors(
      background: TuneFreePalette.background,
      surface: TuneFreePalette.surface,
      textPrimary: TuneFreePalette.textPrimary,
      textSecondary: TuneFreePalette.textSecondary,
      separator: TuneFreePalette.separator,
      border: TuneFreePalette.border,
      accent: accent,
      accentSoft: accent.withValues(alpha: 0.12),
      visualizerBar: const Color(0xFF111111),
      glassSurface: const Color(0xCCFFFFFF),
      glassBorder: const Color(0x14000000),
      lyricActive: const Color(0xFF111111),
      lyricInactive: const Color(0xFFB6B8BF),
      lyricTranslation: const Color(0xFF4B5563),
      inputFill: const Color(0xFFF3F4F6),
      placeholderFill: const Color(0xFFF3F4F6),
      textTertiary: const Color(0xFF9CA3AF),
      textMuted: const Color(0xFF6B7280),
      textSubtle: const Color(0xFF8B8B95),
      fillSubtle: const Color(0xFFF3F4F6),
      fillFaint: const Color(0xFFF9FAFB),
      fillMuted: const Color(0xFFF5F7FA),
      fillPanel: const Color(0xFFF0F1F5),
      borderSubtle: const Color(0xFFE5E7EB),
      danger: const Color(0xFFDC2626),
      textStrong: const Color(0xFF111111),
    );
  }

  /// 暗色。表面层次：页底 → 卡片 → 填充 → 面板，逐级变亮。
  /// 文字层次同向拉开，保证对比度。
  factory TuneFreeColors.dark({required Color accent}) {
    return TuneFreeColors(
      background: const Color(0xFF09090B),
      surface: const Color(0xFF18181B),
      textPrimary: const Color(0xFFF4F4F5),
      textSecondary: const Color(0xFFA1A1AA),
      separator: const Color(0xFF27272A),
      border: const Color(0xFF27272A),
      accent: accent,
      accentSoft: accent.withValues(alpha: 0.18),
      visualizerBar: const Color(0xFFF4F4F5),
      glassSurface: const Color(0xCC18181B),
      glassBorder: const Color(0x14FFFFFF),
      lyricActive: const Color(0xFFF4F4F5),
      lyricInactive: const Color(0xFF6B6B73),
      lyricTranslation: const Color(0xFFA1A1AA),
      inputFill: const Color(0xFF27272A),
      placeholderFill: const Color(0xFF27272A),
      textTertiary: const Color(0xFF8B8B95),
      textMuted: const Color(0xFFA1A1AA),
      textSubtle: const Color(0xFF71717A),
      fillSubtle: const Color(0xFF27272A),
      fillFaint: const Color(0xFF1C1C1F),
      fillMuted: const Color(0xFF202024),
      fillPanel: const Color(0xFF27272A),
      borderSubtle: const Color(0xFF2E2E33),
      danger: const Color(0xFFF87171),
      textStrong: const Color(0xFFF4F4F5),
    );
  }

  @override
  TuneFreeColors copyWith() => this;

  @override
  TuneFreeColors lerp(ThemeExtension<TuneFreeColors>? other, double t) {
    if (other is! TuneFreeColors) {
      return this;
    }
    return TuneFreeColors(
      background: Color.lerp(background, other.background, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      textPrimary: Color.lerp(textPrimary, other.textPrimary, t)!,
      textSecondary: Color.lerp(textSecondary, other.textSecondary, t)!,
      separator: Color.lerp(separator, other.separator, t)!,
      border: Color.lerp(border, other.border, t)!,
      accent: Color.lerp(accent, other.accent, t)!,
      accentSoft: Color.lerp(accentSoft, other.accentSoft, t)!,
      visualizerBar: Color.lerp(visualizerBar, other.visualizerBar, t)!,
      glassSurface: Color.lerp(glassSurface, other.glassSurface, t)!,
      glassBorder: Color.lerp(glassBorder, other.glassBorder, t)!,
      lyricActive: Color.lerp(lyricActive, other.lyricActive, t)!,
      lyricInactive: Color.lerp(lyricInactive, other.lyricInactive, t)!,
      lyricTranslation:
          Color.lerp(lyricTranslation, other.lyricTranslation, t)!,
      inputFill: Color.lerp(inputFill, other.inputFill, t)!,
      placeholderFill: Color.lerp(placeholderFill, other.placeholderFill, t)!,
      textTertiary: Color.lerp(textTertiary, other.textTertiary, t)!,
      textMuted: Color.lerp(textMuted, other.textMuted, t)!,
      textSubtle: Color.lerp(textSubtle, other.textSubtle, t)!,
      fillSubtle: Color.lerp(fillSubtle, other.fillSubtle, t)!,
      fillFaint: Color.lerp(fillFaint, other.fillFaint, t)!,
      fillMuted: Color.lerp(fillMuted, other.fillMuted, t)!,
      fillPanel: Color.lerp(fillPanel, other.fillPanel, t)!,
      borderSubtle: Color.lerp(borderSubtle, other.borderSubtle, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      textStrong: Color.lerp(textStrong, other.textStrong, t)!,
    );
  }
}
