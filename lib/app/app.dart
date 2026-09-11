import 'package:material_ui/material_ui.dart';

// 刻意从 foundation 再导出 Key，而不是 material：
// dart fix 的 migrate_design_widgets 不迁移 export 语句（dart-lang/sdk#63968），
// 若继续从 framework material 导出，就会把已废弃的旧库重新拖回每个 import 本文件
// 的地方（main.dart 与若干测试）。Key 本就来自 foundation，不属于本次拆分。
export 'package:flutter/foundation.dart' show Key;

import 'router/app_router.dart';
import 'theme/app_theme.dart';

class TuneFreeApp extends StatelessWidget {
  const TuneFreeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: 'TuneFree',
      debugShowCheckedModeBanner: false,
      theme: buildTuneFreeTheme(),
      routerConfig: appRouter,
    );
  }
}
