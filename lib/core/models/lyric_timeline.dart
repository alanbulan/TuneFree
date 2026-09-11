import 'package:flutter/foundation.dart';

import 'parsed_lyric.dart';

/// 一个词（中文里就是一个字）在整首歌时间轴上的起止。
///
/// 字段与 Tauri 的逐字结构一一对应（即 `src/core/utils/lyricWordState.ts`
/// 消费的 `{ start, duration, text }`），方便两边对照排查。
///
/// 手写而不用 freezed：它从不跨序列化边界，也不参与 [ParsedLyric] 的相等性，
/// 为它生成一份 .freezed.dart / .g.dart 只会增加噪音。
@immutable
final class LyricWord {
  const LyricWord({
    required this.start,
    required this.duration,
    required this.text,
  });

  /// 起始时间（秒，相对整首歌）。
  final double start;

  /// 持续时长（秒）。估算出来的值恒为正，但真·逐字源里可能为 0。
  final double duration;

  /// 词面。**不含**分隔用的空白（空白权重记在前一个词上）。
  final String text;

  double get end => start + duration;

  @override
  bool operator ==(Object other) =>
      other is LyricWord &&
      other.start == start &&
      other.duration == duration &&
      other.text == text;

  @override
  int get hashCode => Object.hash(start, duration, text);

  @override
  String toString() =>
      'LyricWord(start: $start, duration: $duration, text: "$text")';
}

/// 一行歌词 + 它的结束时间 + 逐字时间。
///
/// [words] 为空表示这一行不做逐字填充（元数据行、间奏、纯版式行），
/// 渲染层退回整行静态文本 —— 这也是改造前所有行的行为。
@immutable
final class TimedLyricLine {
  const TimedLyricLine({
    required this.line,
    required this.endTime,
    required this.words,
  });

  /// 不做逐字填充的行。
  const TimedLyricLine.plain(this.line, {required this.endTime})
    : words = const <LyricWord>[];

  final ParsedLyric line;

  /// 这一行唱完的时间（秒）。末行没有下一行可参照，由估算给出。
  final double endTime;

  final List<LyricWord> words;

  double get startTime => line.time;
  bool get hasWords => words.isNotEmpty;

  @override
  String toString() =>
      'TimedLyricLine($startTime-$endTime, ${words.length} words, '
      '"${line.text}")';
}

/// 一首歌完整的歌词时间轴。
///
/// 与 [ParsedLyric] 分开而不是把 `words` 挂到它上面，是因为逐字时间是
/// **派生**数据：它将来可能来自估算，也可能来自真·逐字源（网易 yrc）。
/// 分开之后 `parseRawLyrics` 保持纯解析，渲染层则与数据来源无关。
@immutable
final class LyricTimeline {
  const LyricTimeline(this.lines);

  static const LyricTimeline empty = LyricTimeline(<TimedLyricLine>[]);

  final List<TimedLyricLine> lines;

  bool get isEmpty => lines.isEmpty;
  int get length => lines.length;

  TimedLyricLine operator [](int index) => lines[index];

  /// 当前时间落在哪一行。取「最后一个已经开始的行」，与改造前的行为一致
  /// （原来这个方法在 `PlayerLyricsController` 上）。
  int activeIndexAt(double currentTime) {
    for (var index = lines.length - 1; index >= 0; index -= 1) {
      if (currentTime >= lines[index].startTime) {
        return index;
      }
    }
    return 0;
  }

  @override
  String toString() => 'LyricTimeline(${lines.length} lines)';
}
