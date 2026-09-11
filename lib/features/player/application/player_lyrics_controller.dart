import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/lyric_timeline.dart';
import '../../../core/models/parsed_lyric.dart';
import '../../../core/utils/lyric_document.dart';
import '../../../core/utils/lyric_word_estimator.dart';
import '../../../core/utils/yrc_parser.dart';

final playerLyricsControllerProvider = Provider<PlayerLyricsController>((ref) {
  return PlayerLyricsController();
});

final class PlayerLyricsController {
  static const _emptyLyrics = [ParsedLyric(time: 0, text: '暂无歌词')];

  /// 解析结果按原始歌词串记忆化。
  ///
  /// 歌词面板会跟着播放位置刷新（位置流约 5Hz），而每次刷新都要重新拿到
  /// 时间轴。不记忆化的话就是每秒 5 次全量 LRC 解析；逐字填充起来之后只会更密。
  String? _cachedRaw;
  List<ParsedLyric>? _cachedLyrics;
  Map<int, List<LyricWord>> _cachedRealWords = const <int, List<LyricWord>>{};
  LyricTimeline? _cachedTimeline;

  List<ParsedLyric> parseRawLyrics(String raw) {
    _ensureParsed(raw);
    return _cachedLyrics!;
  }

  /// 带逐字时间的完整时间轴，供歌词面板渲染。
  ///
  /// 有网易 `yrc` 的行用真·逐字时间，其余行按行内版面权重**估算**
  /// （理由见 `lyric_word_estimator.dart`）。
  LyricTimeline buildLyrics(String raw) {
    _ensureParsed(raw);

    final cachedTimeline = _cachedTimeline;
    if (cachedTimeline != null) {
      return cachedTimeline;
    }

    // 解析不出任何有效行时 parseRawLyrics 返回的是那个哨兵行「暂无歌词」，
    // 它不是歌词，没有可估算的逐字时间。
    final lyrics = _cachedLyrics!;
    final timeline = identical(lyrics, _emptyLyrics)
        ? LyricTimeline([TimedLyricLine.plain(_emptyLyrics.first, endTime: 0)])
        : estimateLyricTimeline(lyrics, realWords: _cachedRealWords);

    _cachedTimeline = timeline;
    return timeline;
  }

  /// 解析一次，顺便把逐字表和派生时间轴的缓存一起对齐。
  ///
  /// 三份结果必须同进同出：歌词串换了而逐字表留在旧的那份上，填充就会
  /// 照着上一首歌的时间走。
  void _ensureParsed(String raw) {
    if (_cachedRaw == raw && _cachedLyrics != null) {
      return;
    }

    final parsed = _parseUncached(raw);
    _cachedRaw = raw;
    _cachedLyrics = parsed.lyrics;
    _cachedRealWords = parsed.realWords;
    _cachedTimeline = null; // 原始串换了，派生的时间轴一并作废
  }

  ({List<ParsedLyric> lyrics, Map<int, List<LyricWord>> realWords})
  _parseUncached(String raw) {
    if (raw.isEmpty) {
      return (lyrics: _emptyLyrics, realWords: const <int, List<LyricWord>>{});
    }

    final document = LyricDocument.parse(raw);
    final karaoke = parseYrcDocument(document.karaoke);

    // 有 yrc 就整份换用它那一套：yrc 自带正文，且它的时间轴与译文/罗马音
    // 同属 v1（实测逐行完全一致），而 GD Studio 的主轨是 legacy 时间轴，
    // 两者逐行差 20–570ms —— 混着用会把词压到隔壁行上。
    final mergedEntries = karaoke.isEmpty
        ? _mergeMainTrack(document.main)
        : karaoke.lines;

    if (mergedEntries.isEmpty) {
      return (lyrics: _emptyLyrics, realWords: const <int, List<LyricWord>>{});
    }

    // 扩展轨道贴在主轨之后。译文轨优先于「近似时间戳」那条老规则：
    // 老规则只在旧格式文档（没有标记、译文和原文混在一段里）上才有用。
    final withTranslation = attachLyricTrack(
      mergedEntries,
      document.translation,
      (line, value) =>
          line.translation == null ? line.copyWith(translation: value) : line,
    );
    final withRomanization = attachLyricTrack(
      withTranslation,
      document.romanization,
      (line, value) => line.copyWith(romanization: value),
    );

    return (
      lyrics: List<ParsedLyric>.unmodifiable(withRomanization),
      realWords: karaoke.wordsByTime,
    );
  }

  /// 主轨解析：解析、排序，再把「时间戳挨得很近」的行并起来。
  ///
  /// 这条 `< 0.5 秒` 的规则是改造前就有的，保留它有两个理由：
  /// - 旧格式的歌词串（译文和原文混在一段里、没有轨道标记）全靠它；
  ///   这类数据还躺在用户已收藏的歌曲里。
  /// - 主轨本身偶尔也有重复行（同一个时间戳出现两次）。
  ///
  /// 它**不再**是译文的唯一来源 —— 带标记的文档由 `attachLyricTrack` 按轨道
  /// 贴，那条路径不会像这里一样把第三条近似行丢掉。
  List<ParsedLyric> _mergeMainTrack(String main) {
    if (main.trim().isEmpty) {
      return const <ParsedLyric>[];
    }

    final parsedEntries = parseLyricTrackLines(main);

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

    return mergedEntries;
  }
}
