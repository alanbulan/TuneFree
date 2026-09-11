import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // 状态栏样式不再在这里设置：它需要跟随主题切换，改由 TuneFreeApp 内部的
  // _SystemChromeSync 在 Theme 之下响应式地处理。
  runApp(const ProviderScope(child: TuneFreeApp()));
}
