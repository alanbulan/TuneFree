import 'package:flutter/material.dart';

class SearchModeSwitcher extends StatelessWidget {
  const SearchModeSwitcher({
    super.key,
    required this.searchMode,
    required this.onModeChanged,
  });

  final String searchMode;
  final ValueChanged<String> onModeChanged;

  @override
  Widget build(BuildContext context) {
    Widget buildChip(
      String label,
      bool active,
      VoidCallback onTap, {
      Color activeBackgroundColor = Colors.black,
      Color activeForegroundColor = Colors.white,
      Color? activeBorderColor,
      Key? key,
    }) {
      final borderColor = active
          ? (activeBorderColor ?? activeBackgroundColor)
          : const Color(0xFFE5E7EB);
      return GestureDetector(
        key: key,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: active ? activeBackgroundColor : Colors.white,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: borderColor),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: active ? activeForegroundColor : const Color(0xFF666666),
            ),
          ),
        ),
      );
    }

    return Wrap(
      spacing: 8,
      children: [
        buildChip(
          '聚合搜索',
          searchMode == 'aggregate',
          () => onModeChanged('aggregate'),
        ),
        buildChip('指定源', searchMode == 'single', () => onModeChanged('single')),
      ],
    );
  }
}
