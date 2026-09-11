import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/lyric_timeline.dart';
import '../../../core/models/parsed_lyric.dart';
import '../../../core/utils/lyric_word_estimator.dart';

final playerLyricsControllerProvider = Provider<PlayerLyricsController>((ref) {
  return PlayerLyricsController();
});

final class PlayerLyricsController {
  static const _emptyLyrics = [ParsedLyric(time: 0, text: '暂无歌词')];
  static final _timeExp = RegExp(r'\[(\d{2}):(\d{2})\.(\d{2,3})\]');

  /// 解析结果按原始歌词串记忆化。
  ///
  /// 歌词面板会跟着播放位置刷新（位置流约 5Hz），而每次刷新都要重新拿到
  /// 时间轴。不记忆化的话就是每秒 5 次全量 LRC 解析；逐字填充起来之后只会更密。
  String? _cachedRaw;
  List<ParsedLyric>? _cachedLyrics;
  LyricTimeline? _cachedTimeline;

  List<ParsedLyric> parseRawLyrics(String raw) {
    final cachedLyrics = _cachedLyrics;
    if (_cachedRaw == raw && cachedLyrics != null) {
      return cachedLyrics;
    }

    final lyrics = _parseUncached(raw);
    _cachedRaw = raw;
    _cachedLyrics = lyrics;
    _cachedTimeline = null; // 原始串换了，派生的时间轴一并作废
    return lyrics;
  }

  /// 带逐字时间的完整时间轴，供歌词面板渲染。
  ///
  /// 逐字时间是**估算**的，理由见 `lyric_word_estimator.dart`。
  LyricTimeline buildLyrics(String raw) {
    final lyrics = parseRawLyrics(raw);

    final cachedTimeline = _cachedTimeline;
    if (cachedTimeline != null) {
      return cachedTimeline;
    }

    // 解析不出任何有效行时 parseRawLyrics 返回的是那个哨兵行「暂无歌词」，
    // 它不是歌词，没有可估算的逐字时间。
    final timeline = identical(lyrics, _emptyLyrics)
        ? LyricTimeline([
            TimedLyricLine.plain(_emptyLyrics.first, endTime: 0),
          ])
        : estimateLyricTimeline(lyrics);

    _cachedTimeline = timeline;
    return timeline;
  }

  List<ParsedLyric> _parseUncached(String raw) {
    if (raw.isEmpty) {
      return _emptyLyrics;
    }

    final parsedEntries =
        raw.split('\n').expand(_parseLine).toList(growable: false)
          ..sort((left, right) => left.time.compareTo(right.time));

    if (parsedEntries.isEmpty) {
      return _emptyLyrics;
    }

    final mergedEntries = <ParsedLyric>[];
    for (final entry in parsedEntries) {
      final previousEntry = mergedEntries.isEmpty ? null : mergedEntries.last;
      final isNearDuplicate =
          previousEntry != null &&
          (entry.time - previousEntry.time).abs() < 0.5;

      if (isNearDuplicate) {
        final shouldMergeAsTranslation =
            previousEntry.translation == null &&
            previousEntry.text != entry.text;

        if (shouldMergeAsTranslation) {
          mergedEntries[mergedEntries.length - 1] = previousEntry.copyWith(
            translation: entry.text,
          );
        }

        continue;
      }

      mergedEntries.add(entry);
    }

    return List<ParsedLyric>.unmodifiable(mergedEntries);
  }

  Iterable<ParsedLyric> _parseLine(String line) sync* {
    final matches = _timeExp.allMatches(line);
    if (matches.isEmpty) {
      return;
    }

    final text = line.replaceAll(_timeExp, '').trim();
    if (text.isEmpty) {
      return;
    }

    for (final match in matches) {
      final minutes = int.parse(match.group(1)!);
      final seconds = int.parse(match.group(2)!);
      final millisecondString = match.group(3)!;
      final millisecondValue = int.parse(millisecondString);
      final milliseconds = millisecondString.length == 2
          ? millisecondValue * 10
          : millisecondValue;
      final time = minutes * 60 + seconds + milliseconds / 1000;

      yield ParsedLyric(time: time, text: text);
    }
  }
}
