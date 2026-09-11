import 'package:material_ui/material_ui.dart';

import 'theme/tune_free_palette.dart';

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
  'bilibili': 'B站',
  'joox': 'JOOX',
};

typedef MusicSourceBadgeColors = ({Color background, Color foreground});

/// 浅色：粉彩底 + 深色字。
const Map<String, MusicSourceBadgeColors> _lightBadgeColors =
    <String, MusicSourceBadgeColors>{
      'netease': (background: Color(0xFFFEE2E2), foreground: Color(0xFFDC2626)),
      'qq': (background: Color(0xFFDCFCE7), foreground: Color(0xFF16A34A)),
      'kuwo': (background: Color(0xFFFEF3C7), foreground: Color(0xFFA16207)),
      'joox': (background: Color(0xFFF3E8FF), foreground: Color(0xFF7E22CE)),
      'bilibili': (
        background: Color(0xFFFCE7F3),
        foreground: Color(0xFFDB2777),
      ),
    };

/// 深色：粉彩底在暗背景上会整片发亮，改成同色相的低透明度底 + 提亮后的字。
const Map<String, MusicSourceBadgeColors> _darkBadgeColors =
    <String, MusicSourceBadgeColors>{
      'netease': (background: Color(0x26DC2626), foreground: Color(0xFFF87171)),
      'qq': (background: Color(0x2616A34A), foreground: Color(0xFF4ADE80)),
      'kuwo': (background: Color(0x26A16207), foreground: Color(0xFFFBBF24)),
      'joox': (background: Color(0x267E22CE), foreground: Color(0xFFC084FC)),
      'bilibili': (
        background: Color(0x26DB2777),
        foreground: Color(0xFFF472B6),
      ),
    };

String musicSourceFullLabel(String source) =>
    _musicSourceFullLabels[source] ?? source;

String musicSourceBadgeLabel(String source) =>
    _musicSourceBadgeLabels[source] ?? source.toUpperCase();

/// 音源徽标配色。未知音源退回中性色。
///
/// 浅色下的回退值刻意与改造前**逐位相同**（0xFFE5E7EB / 0xFF4B5563），
/// 否则浅色外观会悄悄发生变化。
MusicSourceBadgeColors musicSourceBadgeColors(
  String source,
  TuneFreeColors colors,
) {
  final isDark = colors.background.computeLuminance() < 0.5;
  final palette = isDark ? _darkBadgeColors : _lightBadgeColors;
  return palette[source] ??
      (background: colors.borderSubtle, foreground: colors.lyricTranslation);
}
