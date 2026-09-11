import 'package:material_ui/material_ui.dart';

import '../../../../shared/music_source_display.dart';
import '../../../../shared/theme/tune_free_palette.dart';

class TopSourceSwitcher extends StatelessWidget {
  const TopSourceSwitcher({
    super.key,
    required this.activeSource,
    required this.onChanged,
  });

  final String activeSource;
  final ValueChanged<String> onChanged;

  static const sources = <String>['netease', 'qq', 'kuwo'];

  @override
  Widget build(BuildContext context) {
    // 以前这里写死 `#E7E8ED` + 白色滑块 + 黑色文字，深色主题下是一块亮灰色的
    // 底槽配一颗白胶囊，和 `LibraryTabSwitcher` 是同一个毛病。
    final colors = TuneFreeColors.of(context);
    return DecoratedBox(
      decoration: BoxDecoration(
        color: colors.trackFill,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: sources
              .map((source) {
                final isActive = source == activeSource;
                return GestureDetector(
                  onTap: () => onChanged(source),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: isActive ? colors.raisedFill : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      musicSourceBadgeLabel(source),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: isActive ? colors.textStrong : colors.textSubtle,
                      ),
                    ),
                  ),
                );
              })
              .toList(growable: false),
        ),
      ),
    );
  }
}
