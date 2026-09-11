import 'package:material_ui/material_ui.dart';

import '../../shared/theme/tune_free_palette.dart';

ThemeData buildTuneFreeTheme() {
  const brand = TuneFreePalette.accent;
  final scheme = ColorScheme.fromSeed(
    seedColor: brand,
    brightness: Brightness.light,
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme.copyWith(
      primary: TuneFreePalette.accent,
      surface: TuneFreePalette.surface,
      onSurface: TuneFreePalette.textPrimary,
    ),
    scaffoldBackgroundColor: TuneFreePalette.background,
    appBarTheme: const AppBarTheme(
      centerTitle: false,
      surfaceTintColor: Colors.transparent,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      indicatorColor: brand.withValues(alpha: 0.12),
      labelTextStyle: WidgetStateProperty.all(
        const TextStyle(fontWeight: FontWeight.w600),
      ),
    ),
  );
}
