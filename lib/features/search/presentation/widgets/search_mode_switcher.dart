import 'package:flutter/material.dart';

class SearchModeSwitcher extends StatelessWidget {
  const SearchModeSwitcher({
    super.key,
    required this.searchMode,
    required this.includeExtendedSources,
    required this.onModeChanged,
    required this.onToggleExtendedSources,
  });

  final String searchMode;
  final bool includeExtendedSources;
  final ValueChanged<String> onModeChanged;
  final VoidCallback onToggleExtendedSources;

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
      final borderColor = active ? (activeBorderColor ?? activeBackgroundColor) : const Color(0xFFE5E7EB);
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
        buildChip('聚合搜索', searchMode == 'aggregate', () => onModeChanged('aggregate')),
        buildChip('指定源', searchMode == 'single', () => onModeChanged('single')),
        if (searchMode == 'aggregate')
          buildChip(
            '扩展源 ${includeExtendedSources ? '开' : '关'}',
            includeExtendedSources,
            onToggleExtendedSources,
            key: const Key('search-extended-sources-chip'),
            activeBackgroundColor: const Color(0x1AE94B5B),
            activeForegroundColor: const Color(0xFFE94B5B),
            activeBorderColor: const Color(0x33E94B5B),
          ),
      ],
    );
  }
}
