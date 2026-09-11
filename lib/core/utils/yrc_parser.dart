/// 网易 `yrc` 的解析：真正带字级时间的歌词轨。
///
/// 格式与普通 LRC 完全不同，行首是 `[行起,行时长]`（**毫秒整数**），
/// 后面每个词由 `(词起,词时长[,保留])` 前缀引出：
/// ```
/// [830,4980](830,380,0)夢(1210,330,0)な(1540,200,0)ら
/// ```
/// 除了计时行，yrc 还会在开头夹几行 JSON 形式的元数据
/// （`{"t":0,"c":[{"tx":"作词: "},{"tx":"米津玄師"}]}`），这里也一并还原成
/// 普通歌词行，免得「作词/作曲」这几行在有逐字的歌上凭空消失。
///
/// **为什么必须整份换掉主轨，而不是把词贴到现有主轨上**：已实测 GD Studio
/// 给网易源的 `lyric` 与 yrc **不是同一套时间轴** —— 前者等同网易 legacy
/// `/api/song/lyric`（850 / 6650 / 12340ms），后者是 v1 的
/// `yrc`/`ytlrc`/`yromalrc`（830 / 6370 / 11780ms），逐行差 20–570ms。
/// 硬贴会把字压到隔壁行上。所以有 yrc 时，主轨、译文、罗马音**三条一起**
/// 取自 v1（实测三条逐行时间完全一致，42/42），没有 yrc 就整条走老路。
library;

import 'dart:convert';

import '../models/lyric_timeline.dart';
import '../models/parsed_lyric.dart';

/// 计时行：`[行起,行时长]` + 余下的内容。
final RegExp _timedLinePattern = RegExp(r'^\[(\d+),(\d+)\](.*)$');

/// 词：`(词起,词时长[,保留])` 前缀 + 直到下一个前缀为止的词面。
final RegExp _wordPattern = RegExp(r'\((\d+),(\d+)(?:,[^)]*)?\)([^()]*)');

/// 解析结果：一行行可直接当主轨的歌词，外加按行起始时间索引的逐字表。
///
/// [wordsByTime] 的键是 `(秒 * 1000)` 取整 —— 与 [ParsedLyric.time] 同源，
/// 调用方拿 `_timeKey(line.time)` 就能对上。
final class YrcDocument {
  const YrcDocument({required this.lines, required this.wordsByTime});

  static const YrcDocument empty = YrcDocument(
    lines: <ParsedLyric>[],
    wordsByTime: <int, List<LyricWord>>{},
  );

  final List<ParsedLyric> lines;
  final Map<int, List<LyricWord>> wordsByTime;

  bool get isEmpty => lines.isEmpty;
  bool get hasWords => wordsByTime.isNotEmpty;
}

/// 时间轴的键：与 [ParsedLyric.time] 的单位对齐，避免浮点直接比较。
int yrcTimeKey(double seconds) => (seconds * 1000).round();

/// 解析一整份 yrc。认不出来的行直接跳过 —— yrc 里有元数据 JSON、
/// 空行、以及偶尔出现的纯文本行，它们都不带字级时间。
YrcDocument parseYrcDocument(String? raw) {
  final text = raw?.trim() ?? '';
  if (text.isEmpty) {
    return YrcDocument.empty;
  }

  final lines = <ParsedLyric>[];
  final wordsByTime = <int, List<LyricWord>>{};

  for (final rawLine in text.split('\n')) {
    final line = rawLine.trim();
    if (line.isEmpty) {
      continue;
    }

    final timed = _timedLinePattern.firstMatch(line);
    if (timed != null) {
      final lineStart = int.parse(timed.group(1)!) / 1000;
      final content = timed.group(3) ?? '';
      final words = _parseWords(content, lineStart);
      final lineText = _normalizeText(content) ?? _joinWords(words);
      if (lineText.isEmpty) {
        continue;
      }
      lines.add(ParsedLyric(time: lineStart, text: lineText));
      if (words.isNotEmpty) {
        wordsByTime[yrcTimeKey(lineStart)] = words;
      }
      continue;
    }

    final metadata = _parseMetadataLine(line);
    if (metadata != null) {
      lines.add(metadata);
    }
  }

  if (lines.isEmpty) {
    return YrcDocument.empty;
  }

  lines.sort((left, right) => left.time.compareTo(right.time));
  return YrcDocument(
    lines: List<ParsedLyric>.unmodifiable(lines),
    wordsByTime: Map<int, List<LyricWord>>.unmodifiable(wordsByTime),
  );
}

List<LyricWord> _parseWords(String content, double lineStart) {
  final words = <LyricWord>[];
  for (final match in _wordPattern.allMatches(content)) {
    // 词面里可能带换行与连续空格（yrc 用它对齐），压成单个空格。
    final wordText = match.group(3)!.replaceAll(RegExp(r'\s+'), ' ');
    if (wordText.isEmpty) {
      continue;
    }
    final start = _normalizeWordStart(
      int.parse(match.group(1)!) / 1000,
      lineStart,
    );
    final duration = int.parse(match.group(2)!) / 1000;
    words.add(LyricWord(start: start, duration: duration, text: wordText));
  }
  return List<LyricWord>.unmodifiable(words);
}

/// 少数 yrc 里词时间是**相对行首**的偏移。
///
/// 判据与 Tauri 的 `normalizeWordStart` 一致：时间明显早于行首（留 50ms
/// 容忍真正的提前起唱）就当成偏移，加上行首还原成绝对时间。行首为 0 时
/// 两者等价，不做处理。
double _normalizeWordStart(double start, double lineStart) {
  if (lineStart > 0 && start + 0.05 < lineStart) {
    return lineStart + start;
  }
  return start;
}

/// 去掉计时前缀后的纯歌词文本；全是空白就返回 null。
String? _normalizeText(String content) {
  final stripped = content
      .replaceAll(_wordPattern, '')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  return stripped.isEmpty ? null : stripped;
}

String _joinWords(List<LyricWord> words) => words
    .map((word) => word.text)
    .join()
    .replaceAll(RegExp(r'\s+'), ' ')
    .trim();

/// yrc 开头的元数据行：`{"t":0,"c":[{"tx":"作词: "},{"tx":"米津玄師"}]}`。
///
/// 解析失败就返回 null（当普通噪声跳过）—— yrc 的版式不是稳定契约，
/// 认不出来的行不该让整首歌的歌词挂掉。
ParsedLyric? _parseMetadataLine(String line) {
  if (!line.startsWith('{')) {
    return null;
  }
  try {
    final payload = jsonDecode(line);
    if (payload is! Map) {
      return null;
    }
    final time = payload['t'];
    final cells = payload['c'];
    if (time is! num || cells is! List) {
      return null;
    }
    final buffer = StringBuffer();
    for (final cell in cells) {
      if (cell is Map) {
        final fragment = cell['tx'];
        if (fragment is String) {
          buffer.write(fragment);
        }
      }
    }
    final text = buffer.toString().trim();
    return text.isEmpty ? null : ParsedLyric(time: time / 1000, text: text);
  } catch (_) {
    return null;
  }
}
