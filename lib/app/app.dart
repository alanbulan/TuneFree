import 'package:flutter/material.dart';

export 'package:flutter/material.dart' show Key;

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
