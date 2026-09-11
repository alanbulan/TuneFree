import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

// 刻意从 foundation 再导出 Key，而不是 material：
// dart fix 的 migrate_design_widgets 不迁移 export 语句（dart-lang/sdk#63968），
// 若继续从 framework material 导出，就会把已废弃的旧库重新拖回每个 import 本文件
// 的地方（main.dart 与若干测试）。Key 本就来自 foundation，不属于本次拆分。
export 'package:flutter/foundation.dart' show Key;

import '../shared/theme/appearance_controller.dart';
import '../shared/theme/appearance_preferences.dart';
import '../shared/theme/tune_free_palette.dart';
import 'router/app_router.dart';
import 'theme/app_theme.dart';

class TuneFreeApp extends ConsumerWidget {
  const TuneFreeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 用 select 只订阅偏好本身，避免控制器因别的原因 notify 时整棵树重建。
    final preferences = ref.watch(
      appearanceControllerProvider.select((controller) => controller.preferences),
    );

    return MaterialApp.router(
      title: 'TuneFree',
      debugShowCheckedModeBanner: false,
      theme: buildTuneFreeTheme(
        brightness: Brightness.light,
        accent: preferences.accent,
      ),
      darkTheme: buildTuneFreeTheme(
        brightness: Brightness.dark,
        accent: preferences.accent,
      ),
      themeMode: preferences.themeMode.materialMode,
      routerConfig: appRouter,
      // 放在这里才在 Theme 之下，能读到当前主题并响应切换。
      builder: (context, child) => _SystemChromeSync(child: child!),
    );
  }
}

/// 让状态栏/导航栏跟随主题。
///
/// 以前这段是在 `runApp` 之前调用一次的，因此永远停在启动时的浅色值，
/// 运行时切换主题不会生效。
class _SystemChromeSync extends StatefulWidget {
  const _SystemChromeSync({required this.child});

  final Widget child;

  @override
  State<_SystemChromeSync> createState() => _SystemChromeSyncState();
}

class _SystemChromeSyncState extends State<_SystemChromeSync> {
  bool? _appliedIsDark;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final isDark = Theme.of(context).brightness == Brightness.dark;
    if (_appliedIsDark == isDark) {
      return;
    }
    _appliedIsDark = isDark;

    final colors = TuneFreeColors.of(context);
    final iconBrightness = isDark ? Brightness.light : Brightness.dark;
    SystemChrome.setSystemUIOverlayStyle(
      SystemUiOverlayStyle(
        statusBarColor: colors.background,
        statusBarIconBrightness: iconBrightness,
        systemNavigationBarColor: colors.background,
        systemNavigationBarIconBrightness: iconBrightness,
      ),
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
