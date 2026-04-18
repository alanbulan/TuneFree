import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/parsed_lyric.dart';

final playerLyricsControllerProvider = Provider<PlayerLyricsController>((ref) {
  return PlayerLyricsController();
});

final class PlayerLyricsController {
  static const _emptyLyrics = [ParsedLyric(time: 0, text: '暂无歌词')];
  static final _timeExp = RegExp(r'\[(\d{2}):(\d{2})\.(\d{2,3})\]');

  List<ParsedLyric> parseRawLyrics(String raw) {
    if (raw.isEmpty) {
      return _emptyLyrics;
    }

    final parsedEntries = raw
        .split('\n')
        .expand(_parseLine)
        .toList(growable: false)
      ..sort((left, right) => left.time.compareTo(right.time));

    if (parsedEntries.isEmpty) {
      return _emptyLyrics;
    }

    final mergedEntries = <ParsedLyric>[];
    for (final entry in parsedEntries) {
      final previousEntry = mergedEntries.isEmpty ? null : mergedEntries.last;
      final isNearDuplicate = previousEntry != null && (entry.time - previousEntry.time).abs() < 0.5;

      if (isNearDuplicate) {
        final shouldMergeAsTranslation =
            previousEntry.translation == null && previousEntry.text != entry.text;

        if (shouldMergeAsTranslation) {
          mergedEntries[mergedEntries.length - 1] = previousEntry.copyWith(translation: entry.text);
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
      final milliseconds = millisecondString.length == 2 ? millisecondValue * 10 : millisecondValue;
      final time = minutes * 60 + seconds + milliseconds / 1000;

      yield ParsedLyric(time: time, text: text);
    }
  }

  int findActiveIndex(List<ParsedLyric> lyrics, double currentTime) {
    for (var index = lyrics.length - 1; index >= 0; index -= 1) {
      if (currentTime >= lyrics[index].time) {
        return index;
      }
    }

    return 0;
  }
}
