import 'package:material_ui/material_ui.dart';

const Map<String, String> _musicSourceFullLabels = <String, String>{
  'netease': '网易云',
  'qq': 'QQ音乐',
  'kuwo': '酷我音乐',
  'joox': 'JOOX',
  'bilibili': 'Bilibili',
};

const Map<String, String> _musicSourceBadgeLabels = <String, String>{
  'netease': '网易云',
  'qq': 'QQ',
  'kuwo': '酷我',
  'joox': 'JOOX',
  'bilibili': 'B站',
};

const Map<String, ({Color background, Color foreground})>
_musicSourceBadgeColors = <String, ({Color background, Color foreground})>{
  'netease': (background: Color(0xFFFEE2E2), foreground: Color(0xFFDC2626)),
  'qq': (background: Color(0xFFDCFCE7), foreground: Color(0xFF16A34A)),
  'kuwo': (background: Color(0xFFFEF3C7), foreground: Color(0xFFA16207)),
  'joox': (background: Color(0xFFF3E8FF), foreground: Color(0xFF7E22CE)),
  'bilibili': (background: Color(0xFFFCE7F3), foreground: Color(0xFFDB2777)),
};

String musicSourceFullLabel(String source) =>
    _musicSourceFullLabels[source] ?? source;

String musicSourceBadgeLabel(String source) =>
    _musicSourceBadgeLabels[source] ?? source.toUpperCase();

({Color background, Color foreground}) musicSourceBadgeColors(String source) =>
    _musicSourceBadgeColors[source] ??
    (background: const Color(0xFFE5E7EB), foreground: const Color(0xFF4B5563));
