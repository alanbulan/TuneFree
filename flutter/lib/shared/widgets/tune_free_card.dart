import 'package:flutter/material.dart';

import '../theme/tune_free_palette.dart';
import '../theme/tune_free_spacing.dart';

class TuneFreeCard extends StatelessWidget {
  const TuneFreeCard({super.key, required this.child, this.padding = const EdgeInsets.all(12)});

  final Widget child;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: TuneFreePalette.surface,
      borderRadius: BorderRadius.circular(TuneFreeSpacing.cardRadius),
      child: Padding(
        padding: padding,
        child: child,
      ),
    );
  }
}
