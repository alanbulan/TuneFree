import 'package:flutter/material.dart';

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

const Map<String, ({Color background, Color foreground})> _searchSourceBadgeColors =
    <String, ({Color background, Color foreground})>{
      'netease': (background: Color(0xFFFEE2E2), foreground: Color(0xFFDC2626)),
      'qq': (background: Color(0xFFDCFCE7), foreground: Color(0xFF16A34A)),
      'kuwo': (background: Color(0xFFFEF3C7), foreground: Color(0xFFA16207)),
      'joox': (background: Color(0xFFF3E8FF), foreground: Color(0xFF7E22CE)),
      'bilibili': (background: Color(0xFFFCE7F3), foreground: Color(0xFFDB2777)),
    };

String searchSourceFullLabel(String source) => _searchSourceFullLabels[source] ?? source;

String searchSourceBadgeLabel(String source) => _searchSourceBadgeLabels[source] ?? source.toUpperCase();

({Color background, Color foreground}) searchSourceBadgeColors(String source) =>
    _searchSourceBadgeColors[source] ??
    (background: const Color(0xFFE5E7EB), foreground: const Color(0xFF4B5563));

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
    return PopupMenuButton<String>(
      key: const Key('search-source-selector'),
      onSelected: onSelected,
      tooltip: '选择音源',
      color: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      itemBuilder: (context) {
        return _searchSourceFullLabels.entries.map((entry) {
          return PopupMenuItem<String>(
            value: entry.key,
            child: Text(entry.value, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
          );
        }).toList(growable: false);
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: const Color(0xFFE5E7EB)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              searchSourceFullLabel(selectedSource),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Color(0xFF374151),
              ),
            ),
            const SizedBox(width: 4),
            const Icon(Icons.keyboard_arrow_down_rounded, size: 16, color: Color(0xFF6B7280)),
          ],
        ),
      ),
    );
  }
}
