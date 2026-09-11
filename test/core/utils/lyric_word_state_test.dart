import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/lyric_timeline.dart';
import 'package:tunefree/core/utils/lyric_word_state.dart';

List<LyricWord> _words(List<(double, double, String)> raw) => raw
    .map(
      (entry) => LyricWord(start: entry.$1, duration: entry.$2, text: entry.$3),
    )
    .toList(growable: false);

void main() {
  group('lyricWordProgress', () {
    test('未到点、进行中、已唱完', () {
      expect(lyricWordProgress(10, 2, 9.0), 0);
      expect(lyricWordProgress(10, 2, 11.0), closeTo(0.5, 1e-9));
      expect(lyricWordProgress(10, 2, 13.0), 1);
    });

    test('边界取闭区间', () {
      expect(lyricWordProgress(10, 2, 10.0), 0);
      expect(lyricWordProgress(10, 2, 12.0), 1);
    });

    test('零时长的词退化为「到点即满」，不产生 Infinity/NaN', () {
      expect(lyricWordProgress(10, 0, 9.0), 0);
      expect(lyricWordProgress(10, 0, 10.0), 1);
      expect(lyricWordProgress(10, 0, 11.0), 1);
    });
  });

  group('lyricLineProgress', () {
    final words = _words([(10, 1, '你'), (11, 1, '好'), (12, 2, '呀')]);

    test('行首之前是 0，行尾之后是 1', () {
      expect(lyricLineProgress(words, 9.0), 0);
      expect(lyricLineProgress(words, 14.0), 1);
    });

    test('按词的时长加权，而不是按词数平均', () {
      // 前两个词各占 1/4，第三个词占 1/2。
      expect(lyricLineProgress(words, 10.5), closeTo(0.125, 1e-9));
      expect(lyricLineProgress(words, 12.0), closeTo(0.5, 1e-9));
      // 第三个词走到一半 → 0.5 + 0.25。
      expect(lyricLineProgress(words, 13.0), closeTo(0.75, 1e-9));
    });

    test('没有逐字数据时返回 0，让渲染层退回整行静态文本', () {
      expect(lyricLineProgress(const <LyricWord>[], 12.0), 0);
    });

    test('逐字数据之间有间隙时比例停住，不匀速爬过去', () {
      final gapped = _words([(10, 1, '你'), (13, 1, '好')]);
      // 间隙中点：仍然是第一个词唱完的比例。
      expect(lyricLineProgress(gapped, 11.5), closeTo(0.5, 1e-9));
      expect(lyricLineProgress(gapped, 14.0), 1);
    });

    test('全是零时长的词时返回 0，不除零', () {
      final flat = _words([(10, 0, '你'), (11, 0, '好')]);
      expect(lyricLineProgress(flat, 12.0), 0);
    });
  });
}
