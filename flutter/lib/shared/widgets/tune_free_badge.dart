import 'package:flutter/material.dart';

class TuneFreeBadge extends StatelessWidget {
  const TuneFreeBadge({super.key, required this.text, required this.background, required this.foreground});

  final String text;
  final Color background;
  final Color foreground;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(text, style: TextStyle(fontSize: 10, color: foreground, fontWeight: FontWeight.w600)),
    );
  }
}
