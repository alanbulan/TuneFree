import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/lyric_timeline.dart';
import 'package:tunefree/core/models/parsed_lyric.dart';
import 'package:tunefree/core/utils/lyric_word_estimator.dart';

List<ParsedLyric> _lines(Map<double, String> entries) {
  final sorted = entries.entries.toList()
    ..sort((left, right) => left.key.compareTo(right.key));
  return sorted
      .map((entry) => ParsedLyric(time: entry.key, text: entry.value))
      .toList(growable: false);
}

void main() {
  group('estimateLyricTimeline 切词', () {
    test('中文逐字切开，标点粘到前一个字上', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '你好，世界', 14.0: '下一句'}),
      );

      expect(timeline[0].words.map((word) => word.text), <String>[
        '你',
        '好，',
        '世',
        '界',
      ]);
    });

    test('拉丁按空白分词，空白留在前一个词上', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: 'hello brave world', 14.0: '下一句'}),
      );

      final words = timeline[0].words;
      expect(words.map((word) => word.text), <String>[
        'hello ',
        'brave ',
        'world',
      ]);
      // 拼回去必须还是原文 —— 将来按词渲染时不需要另存一份原始行。
      expect(words.map((word) => word.text).join(), 'hello brave world');
    });

    test('中英混排时英文整词、中文逐字', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '爱你 baby', 14.0: '下一句'}),
      );

      expect(timeline[0].words.map((word) => word.text), <String>[
        '爱',
        '你 ',
        'baby',
      ]);
    });

    test('多个时间标签的同文行（重复行）各自拿到逐字', () {
      final timeline = estimateLyricTimeline(
        _lines({1.0: '开场', 3.0: '开场', 5.0: '尾句'}),
      );

      expect(timeline.lines, hasLength(3));
      for (final line in timeline.lines) {
        expect(line.hasWords, isTrue);
      }
    });
  });

  group('estimateLyricTimeline 时间分配', () {
    test('行内时间连续：每个词接着上一个词结束', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '你好，世界', 14.0: '下一句'}),
      );

      final words = timeline[0].words;
      for (var index = 1; index < words.length; index += 1) {
        expect(words[index].start, closeTo(words[index - 1].end, 1e-9));
      }
      expect(timeline[0].endTime, closeTo(words.last.end, 1e-9));
    });

    test('行首留余量，行尾不越过下一行', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '我爱你', 14.0: '下一句'}),
      );

      final line = timeline[0];
      // 6% 前导：不是行时间一到就开始填。
      expect(line.words.first.start, closeTo(10.24, 1e-9));
      expect(line.words.last.end, lessThanOrEqualTo(14.0));
      expect(line.endTime, closeTo(12.09, 1e-9));
    });

    test('等宽的中文字拿到等长的时间', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '我爱你', 14.0: '下一句'}),
      );

      final durations = timeline[0].words
          .map((word) => word.duration)
          .toList(growable: false);
      expect(durations, hasLength(3));
      expect(durations[1], closeTo(durations[0], 1e-9));
      expect(durations[2], closeTo(durations[0], 1e-9));
    });

    test('长英文词按字数拿到更多时间', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: 'no wonderful', 14.0: '下一句'}),
      );

      final words = timeline[0].words;
      // 'no ' 权重 1.25，'wonderful' 权重 4.5。
      expect(words[0].duration, lessThan(words[1].duration));
      expect(words[1].duration / words[0].duration, closeTo(4.5 / 1.25, 1e-6));
    });

    test('唱完歇几拍的散行会被上限收住，而不是拖成慢动作', () {
      final timeline = estimateLyricTimeline(_lines({10.0: '哦', 15.0: '下一句'}));

      final line = timeline[0];
      // 行跨度 5 秒，一个字；不设上限的话这里会是 4.3 秒。
      expect(line.words.single.duration, closeTo(0.85, 1e-9));
      expect(line.endTime, closeTo(10.3 + 0.85, 1e-9));
    });

    test('末行没有下一行可参照，按字数估一个跨度', () {
      final timeline = estimateLyricTimeline(_lines({10.0: '最后一句话'}));

      final line = timeline[0];
      expect(line.hasWords, isTrue);
      // span = max(2.0, 5 * 0.18) = 2.0 → 前导 0.12，可唱 1.72。
      expect(line.words.first.start, closeTo(10.12, 1e-9));
      expect(line.endTime, closeTo(11.84, 1e-9));
    });
  });

  group('estimateLyricTimeline 不做逐字的情形', () {
    test('作词/作曲这类元数据行不合成', () {
      final timeline = estimateLyricTimeline(
        _lines({0.0: '作词：张三', 4.0: '第一句'}),
      );

      expect(timeline[0].words, isEmpty);
      expect(timeline[0].hasWords, isFalse);
      expect(timeline[1].hasWords, isTrue);
    });

    test('正文里出现「曲」字不会被误判成元数据', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '曲终人散', 14.0: '下一句'}),
      );

      expect(timeline[0].hasWords, isTrue);
    });

    test('超过 8 秒的空档视为间奏，不合成', () {
      final timeline = estimateLyricTimeline(_lines({10.0: '哦', 30.0: '下一句'}));

      expect(timeline[0].words, isEmpty);
      expect(timeline[0].endTime, closeTo(30.0, 1e-9));
    });

    test('没有逐字的行仍然有起始时间，渲染层可退回普通文本', () {
      final timeline = estimateLyricTimeline(
        _lines({0.0: '作词：张三', 4.0: '第一句'}),
      );

      expect(timeline[0].startTime, 0.0);
      expect(timeline[0].line.text, '作词：张三');
    });

    test('空输入得到空时间轴', () {
      expect(estimateLyricTimeline(const <ParsedLyric>[]).isEmpty, isTrue);
    });
  });

  group('estimateLyricTimeline 真·逐字覆盖', () {
    const real = <LyricWord>[
      LyricWord(start: 10.0, duration: 0.4, text: '你'),
      LyricWord(start: 10.4, duration: 0.6, text: '好'),
    ];

    test('命中的行直接用真数据，行尾也跟着它走', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '你好', 14.0: '下一句'}),
        realWords: const {10000: real},
      );

      expect(timeline[0].words, real);
      // 估算会留 6% 前导余量、按权重摊时长，真数据不该被这些规则改写。
      expect(timeline[0].words.first.start, 10.0);
      expect(timeline[0].endTime, closeTo(11.0, 1e-9));
    });

    test('没命中的行照旧估算', () {
      final timeline = estimateLyricTimeline(
        _lines({10.0: '你好', 14.0: '下一句'}),
        realWords: const {10000: real},
      );

      expect(timeline[1].hasWords, isTrue);
      expect(timeline[1].words.first.text, '下');
      expect(timeline[1].words.first.start, greaterThan(14.0));
    });

    test('不给真数据时与改造前完全一致', () {
      final lines = _lines({10.0: '你好', 14.0: '下一句'});
      final timeline = estimateLyricTimeline(lines);

      expect(timeline[0].words.map((word) => word.text), <String>['你', '好']);
      expect(timeline[0].words.first.start, closeTo(10.24, 1e-9));
    });
  });

  group('LyricTimeline.activeIndexAt', () {
    final timeline = estimateLyricTimeline(_lines({1.0: '第一句', 3.5: '第二句'}));

    test('当前时间之前取第一行', () {
      expect(timeline.activeIndexAt(0.5), 0);
    });

    test('越过第二个时间点取第二行', () {
      expect(timeline.activeIndexAt(3.6), 1);
    });

    test('空时间轴返回 0', () {
      expect(LyricTimeline.empty.activeIndexAt(12.0), 0);
    });
  });

  group('lyricSeekTarget', () {
    test('没有偏移时就是行时间', () {
      expect(
        lyricSeekTarget(12.5, Duration.zero),
        const Duration(milliseconds: 12500),
      );
    });

    test('歌词推迟了 2 秒，就要早 2 秒开始放', () {
      // 偏移 +2s 时这一行在第 12 秒才亮，所以要现在听到它必须回到第 10 秒。
      expect(
        lyricSeekTarget(12.0, const Duration(seconds: 2)),
        const Duration(seconds: 10),
      );
    });

    test('歌词提前了 2 秒，就要晚 2 秒开始放', () {
      expect(
        lyricSeekTarget(12.0, const Duration(seconds: -2)),
        const Duration(seconds: 14),
      );
    });

    test('算出来是负数时夹到 0，不产生负的播放位置', () {
      expect(lyricSeekTarget(1.0, const Duration(seconds: 5)), Duration.zero);
    });
  });
}
