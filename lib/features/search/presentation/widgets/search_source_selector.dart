import 'package:material_ui/material_ui.dart';

import '../../../../shared/music_source_display.dart';
import '../../../../shared/theme/tune_free_palette.dart';

const Map<String, String> _searchSourceFullLabels = <String, String>{
  'netease': '网易云',
  'qq': 'QQ音乐',
  'kuwo': '酷我音乐',
  'joox': 'JOOX',
  'bilibili': 'Bilibili',
};

const Map<String, String> _searchSourceBadgeLabels = <String, String>{
  'netease': '网易云',
  'qq': 'QQ',
  'kuwo': '酷我',
  'joox': 'JOOX',
  'bilibili': 'B站',
};

String searchSourceFullLabel(String source) =>
    _searchSourceFullLabels[source] ?? source;

String searchSourceBadgeLabel(String source) =>
    _searchSourceBadgeLabels[source] ?? source.toUpperCase();

/// 与 `music_source_display.dart` 的音源徽标是同一套配色，这里不再复制一份
/// —— 重复的那份在加暗色时刻意漏掉，正是这类复制品会漂移的原因。
({Color background, Color foreground}) searchSourceBadgeColors(
  String source,
  TuneFreeColors colors,
) => musicSourceBadgeColors(source, colors);

class SearchSourceSelector extends StatelessWidget {
  const SearchSourceSelector({
    super.key,
    required this.selectedSource,
    required this.onSelected,
  });

  final String selectedSource;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return PopupMenuButton<String>(
      key: const Key('search-source-selector'),
      onSelected: onSelected,
      tooltip: '选择音源',
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      itemBuilder: (context) {
        return _searchSourceFullLabels.entries
            .map((entry) {
              return PopupMenuItem<String>(
                value: entry.key,
                child: Text(
                  entry.value,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              );
            })
            .toList(growable: false);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: colors.borderSubtle),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              searchSourceFullLabel(selectedSource),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: Color(0xFF374151),
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              Icons.keyboard_arrow_down_rounded,
              size: 15,
              color: colors.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}
