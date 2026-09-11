/// 按行内权重把行跨度摊到每个字/词上，得到**估算**的逐字时间。
///
/// **这不是真正的逐字歌词。** 本应用接到的歌词源（GD Studio 的
/// `types=lyric`、酷我兜底）只提供整行时间轴，正文是纯 `[mm:ss.mmm]文本`，
/// 没有任何字级标记；真·逐字需要另外直连网易 `yrc` / QQ `QRC`。
/// 所以这里做的是「把这一行的时长按版面宽度分给每个字」，
/// 用于卡拉OK 式的连续填充，不是逐字对齐。
///
/// 已知的取舍：
/// - 一行唱到一半换气、拖腔，估算无法体现，填充会匀速走完全程；
/// - 行内若混排中英文，英文按 0.5 个字宽计权，是个近似值。
library;

import 'dart:math' as math;

import 'package:flutter/foundation.dart';

import '../models/lyric_timeline.dart';
import '../models/parsed_lyric.dart';

/// 行首余量。LRC 的行时间普遍略微**早于**真实起唱，不留余量会显得抢拍。
const double _kHeadMargin = 0.06;

/// 行尾余量，留给换气与下一行的起唱。
const double _kTailMargin = 0.08;

/// 超过这个跨度的行视为间奏/纯音乐，不做逐字：让填充在几秒里慢慢爬完
/// 比不做还难看。
const double _kMaxSpan = 8.0;

/// 行内可唱时长的上限：约 0.5 秒/权重单位 + 一点固定开销。
///
/// 歌词密集时行跨度本来就接近这个值，不受影响；「唱完歇几拍」的散行会被它
/// 收住，否则整行填充会变成慢动作。
const double _kSecondsPerUnit = 0.5;
const double _kLineOverhead = 0.35;
const double _kMinSingable = 0.8;

/// 末行没有下一行可参照，按字数估一个跨度。
const double _kMinLastSpan = 2.0;
const double _kLastSpanPerChar = 0.18;

/// 版面权重：CJK 一个字算 1，拉丁字母/数字算半个，空白算 1/4。
const double _kCjkWeight = 1.0;
const double _kLatinWeight = 0.5;
const double _kSpaceWeight = 0.25;

/// `作词：` `作曲：` 这类元数据行不唱，也就不该有逐字填充。
/// 必须锚定到「短标签 + 冒号」，否则「曲终人散」这种正文会被误伤。
final RegExp _metadataPattern = RegExp(
  r'^\s*(作词|作曲|编曲|制作人|出品人|出品|监制|录音师|录音|混音|母带|吉他|贝斯|'
  r'键盘|和声|弦乐|统筹|策划|封面|海报|发行|OP/SP|OP|SP|词|曲|演唱|原唱|翻唱)'
  r'\s*[:：]',
  caseSensitive: false,
);

/// 标点与符号：粘到前一个词上，不单独占一拍。
/// 「，」在中文歌词里是行内停顿，不是独立音节。
final RegExp _punctuationPattern = RegExp(r'[\p{P}\p{S}]', unicode: true);

/// 由纯文本歌词推出带逐字时间的完整时间轴。
LyricTimeline estimateLyricTimeline(List<ParsedLyric> lines) {
  if (lines.isEmpty) {
    return LyricTimeline.empty;
  }

  final timed = <TimedLyricLine>[];
  for (var index = 0; index < lines.length; index += 1) {
    final line = lines[index];
    final next = index + 1 < lines.length ? lines[index + 1] : null;
    final span = next != null
        ? next.time - line.time
        : _lastLineSpan(line.text);
    final words = _estimateWords(line.text, line.time, span);

    timed.add(
      words.isEmpty
          ? TimedLyricLine.plain(
              line,
              endTime: line.time + math.max(span, 0),
            )
          : TimedLyricLine(
              line: line,
              endTime: words.last.end,
              words: words,
            ),
    );
  }

  return LyricTimeline(List<TimedLyricLine>.unmodifiable(timed));
}

double _lastLineSpan(String text) =>
    math.max(_kMinLastSpan, text.runes.length * _kLastSpanPerChar);

List<LyricWord> _estimateWords(String text, double start, double span) {
  if (span <= 0 || span > _kMaxSpan || _metadataPattern.hasMatch(text)) {
    return const <LyricWord>[];
  }

  final tokens = _tokenize(text);
  if (tokens.isEmpty) {
    return const <LyricWord>[];
  }

  final totalWeight = tokens.fold<double>(0, (sum, token) => sum + token.weight);
  if (totalWeight <= 0) {
    return const <LyricWord>[];
  }

  final singable = math.min(
    span * (1 - _kHeadMargin - _kTailMargin),
    math.max(_kMinSingable, _kSecondsPerUnit * totalWeight + _kLineOverhead),
  );
  if (singable <= 0) {
    return const <LyricWord>[];
  }

  final words = <LyricWord>[];
  var cursor = start + span * _kHeadMargin;
  for (final token in tokens) {
    final duration = singable * (token.weight / totalWeight);
    words.add(LyricWord(start: cursor, duration: duration, text: token.text));
    cursor += duration;
  }
  return List<LyricWord>.unmodifiable(words);
}

/// 切词：CJK 逐字，拉丁按空白分词，标点粘前。
///
/// 结果里各 token 的 `text` 顺序拼接后与原文一致（首尾空白除外），
/// 所以将来真·逐字源接进来时，按词渲染不需要另存一份原文。
List<_Token> _tokenize(String text) {
  final tokens = <_Token>[];
  final buffer = StringBuffer();
  var bufferWeight = 0.0;

  void flush() {
    if (buffer.isEmpty) {
      return;
    }
    tokens.add(_Token(buffer.toString(), bufferWeight));
    buffer.clear();
    bufferWeight = 0;
  }

  /// 把空白/标点接到上一个已完成的词上。
  void glueToPrevious(String value, double weight) {
    if (tokens.isEmpty) {
      return;
    }
    final previous = tokens.removeLast();
    tokens.add(_Token('${previous.text}$value', previous.weight + weight));
  }

  for (final rune in text.runes) {
    final char = String.fromCharCode(rune);
    if (_isCjk(rune)) {
      flush();
      tokens.add(_Token(char, _kCjkWeight));
    } else if (char.trim().isEmpty) {
      if (buffer.isNotEmpty) {
        // 空白收尾当前这个词并结算 —— 它占版面宽度，得算进权重，
        // 否则拉丁文多的行里填充边会跑到字前面。
        buffer.write(char);
        bufferWeight += _kSpaceWeight;
        flush();
      } else {
        glueToPrevious(char, _kSpaceWeight);
      }
    } else if (_punctuationPattern.hasMatch(char)) {
      if (buffer.isNotEmpty) {
        buffer.write(char);
        bufferWeight += _kLatinWeight;
      } else {
        glueToPrevious(char, _kLatinWeight);
      }
    } else {
      buffer.write(char);
      bufferWeight += _kLatinWeight;
    }
  }
  flush();

  return tokens;
}

/// 逐字单位：汉字、假名、谚文。
bool _isCjk(int rune) =>
    (rune >= 0x3040 && rune <= 0x30FF) || // 平假名 / 片假名
    (rune >= 0x3400 && rune <= 0x4DBF) || // 汉字扩展 A
    (rune >= 0x4E00 && rune <= 0x9FFF) || // 汉字基本区
    (rune >= 0xAC00 && rune <= 0xD7AF) || // 谚文音节
    (rune >= 0xF900 && rune <= 0xFAFF) || // 兼容汉字
    (rune >= 0x20000 && rune <= 0x2FA1F); // 汉字扩展 B 及以上

@immutable
final class _Token {
  const _Token(this.text, this.weight);

  final String text;

  /// 版面权重，用来把行内可唱时长按比例分下去。
  final double weight;
}
