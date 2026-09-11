import '../models/parsed_lyric.dart';

/// 带轨道标记的歌词文档。
///
/// 形如：
/// ```
/// [00:01.00]原文
/// [tunefree:translation]
/// [00:01.00]译文
/// [tunefree:romanization]
/// [00:01.00]romaji
/// ```
/// **没有标记的旧文档整段当主轨** —— 与改造前的输入完全兼容，所以已存在
/// 收藏里的旧歌词串不会因为这次改动而错乱。
///
/// 为什么用「一个字符串 + 标记」而不是给 `Song` 加字段：歌词全程以单个字符串
/// 传递（解析、缓存、播放队列、落盘都靠它），加字段要连带改 freezed 模型和
/// 沿途每一处。Tauri 那边也是同一套做法（`trackMarkerPattern` + 别名表），
/// 只是它的轨道种类更多。
///
/// 轨道种类比 Tauri 少：那边还解析音译轨和逐字轨，但**现有音源提供不了**
/// —— 已实测 GD Studio 的 `types=lyric` 在 netease / joox / kuwo 三个源上
/// 都只返回 `lyric` + `tlyric`，罗马音得另外直连网易。提供不了的轨道不做。
final class LyricDocument {
  const LyricDocument({
    required this.main,
    this.translation = '',
    this.romanization = '',
  });

  final String main;
  final String translation;
  final String romanization;

  static const String translationMarker = '[tunefree:translation]';
  static const String romanizationMarker = '[tunefree:romanization]';

  /// 把文档切回各条轨道。没有标记时整段都是主轨。
  static LyricDocument parse(String raw) {
    if (raw.isEmpty) {
      return const LyricDocument(main: '');
    }

    var main = <String>[];
    var translation = <String>[];
    var romanization = <String>[];
    var current = main;

    for (final line in raw.split('\n')) {
      switch (line.trim()) {
        case translationMarker:
          current = translation;
        case romanizationMarker:
          current = romanization;
        default:
          current.add(line);
      }
    }

    return LyricDocument(
      main: main.join('\n'),
      translation: translation.join('\n'),
      romanization: romanization.join('\n'),
    );
  }

  /// 拼回一个文档串。空轨道不写标记，免得留下没有内容的空段。
  String encode() {
    final buffer = StringBuffer(main);
    if (translation.trim().isNotEmpty) {
      buffer
        ..write('\n')
        ..write(translationMarker)
        ..write('\n')
        ..write(translation);
    }
    if (romanization.trim().isNotEmpty) {
      buffer
        ..write('\n')
        ..write(romanizationMarker)
        ..write('\n')
        ..write(romanization);
    }
    return buffer.toString();
  }
}

/// 把一条扩展轨道（译文 / 罗马音）贴到主轨上。
///
/// 匹配策略与 Tauri 的 `attachExtensionTrack` 同一套：先找时间戳完全相同的，
/// 再退到容差内最近的**未占用**行。实测 GD Studio 的译文轨与主轨时间戳完全
/// 一致（差值 0.0），所以正常情况都走第一条路径，容差只是兜底。
List<ParsedLyric> attachLyricTrack(
  List<ParsedLyric> base,
  String rawTrack,
  ParsedLyric Function(ParsedLyric line, String value) apply,
) {
  if (base.isEmpty || rawTrack.trim().isEmpty) {
    return base;
  }

  final entries = parseLyricTrackLines(rawTrack);
  if (entries.isEmpty) {
    return base;
  }

  final result = <ParsedLyric>[...base];
  final used = <int>{};
  for (final entry in entries) {
    final index = _matchLineIndex(result, entry.time, used);
    if (index < 0) {
      continue;
    }
    result[index] = apply(result[index], entry.text);
    used.add(index);
  }
  return List<ParsedLyric>.unmodifiable(result);
}

/// 容差。实测译文轨与主轨是精确对齐的，这个值只用来兜住各源之间偶尔的
/// 几十毫秒出入；放大会开始把相邻行配错。
const double _trackToleranceSeconds = 0.3;

int _matchLineIndex(List<ParsedLyric> lines, double time, Set<int> used) {
  var exact = -1;
  var nearest = -1;
  var nearestDelta = double.infinity;

  for (var index = 0; index < lines.length; index += 1) {
    if (used.contains(index)) {
      continue;
    }
    final delta = (lines[index].time - time).abs();
    if (delta == 0) {
      exact = index;
      break;
    }
    if (delta <= _trackToleranceSeconds && delta < nearestDelta) {
      nearest = index;
      nearestDelta = delta;
    }
  }

  return exact >= 0 ? exact : nearest;
}

final RegExp _timeExp = RegExp(r'\[(\d{2}):(\d{2})\.(\d{2,3})\]');

/// 解析一条纯 LRC 轨道，按时间排序。
List<ParsedLyric> parseLyricTrackLines(String raw) {
  if (raw.trim().isEmpty) {
    return const <ParsedLyric>[];
  }

  final entries = <ParsedLyric>[];
  for (final line in raw.split('\n')) {
    final matches = _timeExp.allMatches(line);
    if (matches.isEmpty) {
      continue;
    }
    final text = line.replaceAll(_timeExp, '').trim();
    if (text.isEmpty) {
      continue;
    }
    for (final match in matches) {
      entries.add(ParsedLyric(time: _secondsOf(match), text: text));
    }
  }

  entries.sort((left, right) => left.time.compareTo(right.time));
  return List<ParsedLyric>.unmodifiable(entries);
}

double _secondsOf(RegExpMatch match) {
  final minutes = int.parse(match.group(1)!);
  final seconds = int.parse(match.group(2)!);
  final millisecondString = match.group(3)!;
  final millisecondValue = int.parse(millisecondString);
  // `[mm:ss.xx]` 是厘秒，`[mm:ss.xxx]` 是毫秒 —— 两种写法都要认。
  final milliseconds = millisecondString.length == 2
      ? millisecondValue * 10
      : millisecondValue;
  return minutes * 60 + seconds + milliseconds / 1000;
}
