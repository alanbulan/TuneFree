import 'package:material_ui/material_ui.dart';
import '../../../../shared/theme/tune_free_palette.dart';

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
    final colors = TuneFreeColors.of(context);
    Widget buildChip(
      String label,
      bool active,
      VoidCallback onTap, {
      Color? activeBackgroundColor,
      Color? activeForegroundColor,
      Color? activeBorderColor,
      Key? key,
    }) {
      // 选中的胶囊是**反色**的：浅色下黑底白字，深色下白底深字。
      // 以前写死黑底白字 —— 深色主题下这颗胶囊连边框一起整颗消失。
      final resolvedBackground = activeBackgroundColor ?? colors.textStrong;
      final resolvedForeground = activeForegroundColor ?? colors.surface;
      final borderColor = active
          ? (activeBorderColor ?? resolvedBackground)
          : colors.borderSubtle;
      return GestureDetector(
        key: key,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          decoration: BoxDecoration(
            // 未选中的胶囊用「抬起的面」色：浅色下是白的，深色下比页底亮一档。
            // 换成 colors.surface 的话深色下它和页底几乎同色，只剩一圈边框。
            color: active ? resolvedBackground : colors.raisedFill,
            borderRadius: BorderRadius.circular(999),
            border: Border.all(color: borderColor),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: active ? resolvedForeground : colors.textMuted,
            ),
          ),
        ),
      );
    }

    return Wrap(
      spacing: 6,
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
