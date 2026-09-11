import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/parsed_lyric.dart';
import 'package:tunefree/core/utils/lyric_document.dart';

void main() {
  group('LyricDocument.parse', () {
    test('没有标记的旧文档整段当主轨', () {
      const raw = '[00:01.00]第一句\n[00:02.00]第二句';
      final document = LyricDocument.parse(raw);

      expect(document.main, raw);
      expect(document.translation, isEmpty);
      expect(document.romanization, isEmpty);
    });

    test('按标记切开三条轨道', () {
      final document = LyricDocument.parse(
        '[00:01.00]原文\n'
        '${LyricDocument.translationMarker}\n'
        '[00:01.00]译文\n'
        '${LyricDocument.romanizationMarker}\n'
        '[00:01.00]romaji',
      );

      expect(document.main.trim(), '[00:01.00]原文');
      expect(document.translation.trim(), '[00:01.00]译文');
      expect(document.romanization.trim(), '[00:01.00]romaji');
    });

    test('逐字轨里带括号和逗号，不会被当成译文或罗马音', () {
      final document = LyricDocument.parse(
        '${LyricDocument.translationMarker}\n'
        '[00:00.830]如果这一切都是梦境\n'
        '${LyricDocument.romanizationMarker}\n'
        '[00:00.830]yu me na ra ba\n'
        '${LyricDocument.karaokeMarker}\n'
        '[830,4980](830,380,0)夢(1210,330,0)な',
      );

      expect(document.main, isEmpty);
      expect(document.translation.trim(), '[00:00.830]如果这一切都是梦境');
      expect(document.romanization.trim(), '[00:00.830]yu me na ra ba');
      expect(document.karaoke.trim(), '[830,4980](830,380,0)夢(1210,330,0)な');
    });

    test('空串得到空的文档', () {
      final document = LyricDocument.parse('');
      expect(document.main, isEmpty);
    });
  });

  group('LyricDocument.encode', () {
    test('往返后内容不变', () {
      const document = LyricDocument(
        main: '[00:01.00]原文',
        translation: '[00:01.00]译文',
        romanization: '[00:01.00]romaji',
      );

      final restored = LyricDocument.parse(document.encode());

      expect(restored.main.trim(), document.main);
      expect(restored.translation.trim(), document.translation);
      expect(restored.romanization.trim(), document.romanization);
    });

    test('空轨道不写标记，免得留下空段', () {
      const document = LyricDocument(main: '[00:01.00]原文');
      final encoded = document.encode();

      expect(encoded.contains(LyricDocument.translationMarker), isFalse);
      expect(encoded.contains(LyricDocument.romanizationMarker), isFalse);
      expect(encoded.contains(LyricDocument.karaokeMarker), isFalse);
    });

    test('主轨为空、只有逐字轨时也能往返，且不留开头空行', () {
      // 有 yrc 的歌主轨就是空的（正文由逐字轨自带），这是常态而不是异常。
      const document = LyricDocument(
        main: '',
        translation: '[00:00.830]如果这一切都是梦境',
        karaoke: '[830,4980](830,380,0)夢',
      );

      final encoded = document.encode();
      expect(encoded.startsWith(LyricDocument.translationMarker), isTrue);

      final restored = LyricDocument.parse(encoded);
      expect(restored.main.trim(), isEmpty);
      expect(restored.translation.trim(), document.translation);
      expect(restored.karaoke.trim(), document.karaoke);
    });

    test('只有罗马音时也能往返', () {
      const document = LyricDocument(
        main: '[00:01.00]原文',
        romanization: '[00:01.00]romaji',
      );
      final restored = LyricDocument.parse(document.encode());

      expect(restored.translation, isEmpty);
      expect(restored.romanization.trim(), '[00:01.00]romaji');
    });
  });

  group('parseLyricTrackLines', () {
    test('按时间排序，并跳过没有时间戳的行', () {
      final lines = parseLyricTrackLines(
        '[by:某人]\n[00:05.00]后一句\n[00:01.00]前一句\n',
      );

      expect(lines.map((line) => line.text), <String>['前一句', '后一句']);
      expect(lines.map((line) => line.time), <double>[1.0, 5.0]);
    });

    test('厘秒与毫秒两种写法都认', () {
      final lines = parseLyricTrackLines('[00:01.50]厘秒\n[00:02.500]毫秒');

      expect(lines.map((line) => line.time), <double>[1.5, 2.5]);
    });

    test('一行多个时间戳会展开成多行', () {
      final lines = parseLyricTrackLines('[00:03.00][00:01.00]副歌');
      expect(lines.map((line) => line.time), <double>[1.0, 3.0]);
    });
  });

  group('attachLyricTrack', () {
    const base = <ParsedLyric>[
      ParsedLyric(time: 1.0, text: '第一句'),
      ParsedLyric(time: 2.0, text: '第二句'),
    ];

    ParsedLyric attachTranslation(ParsedLyric line, String value) =>
        line.copyWith(translation: value);

    test('时间戳完全相同时贴上去', () {
      final result = attachLyricTrack(
        base,
        '[00:02.00]second\n[00:01.00]first',
        attachTranslation,
      );

      expect(result[0].translation, 'first');
      expect(result[1].translation, 'second');
    });

    test('容差内的偏移也能配上', () {
      final result = attachLyricTrack(
        base,
        '[00:01.20]first',
        attachTranslation,
      );

      expect(result[0].translation, 'first');
      expect(result[1].translation, isNull);
    });

    test('超出容差不硬配，宁可留空', () {
      // 1.5 距两条主轨都是 0.5 秒，超出 0.3 的容差。
      final result = attachLyricTrack(
        base,
        '[00:01.50]way off',
        attachTranslation,
      );

      expect(result.every((line) => line.translation == null), isTrue);
    });

    test('同一行不会被两条扩展轨道重复占用', () {
      final result = attachLyricTrack(
        base,
        '[00:01.00]first\n[00:01.10]another',
        attachTranslation,
      );

      // 第二条只能去找别的主轨，配不上就丢掉，而不是覆盖第一条。
      expect(result[0].translation, 'first');
      expect(result[1].translation, isNull);
    });

    test('空轨道原样返回', () {
      final result = attachLyricTrack(base, '', attachTranslation);
      expect(identical(result, base), isTrue);
    });
  });
}
