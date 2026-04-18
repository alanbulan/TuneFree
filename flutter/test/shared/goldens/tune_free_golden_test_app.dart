import 'package:flutter/material.dart';
import 'package:tunefree/shared/theme/tune_free_palette.dart';

class TuneFreeGoldenTestApp extends StatelessWidget {
  const TuneFreeGoldenTestApp({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: ColoredBox(
        color: TuneFreePalette.background,
        child: child,
      ),
    );
  }
}
