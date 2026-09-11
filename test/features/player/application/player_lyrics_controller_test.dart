import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/parsed_lyric.dart';
import 'package:tunefree/features/player/application/player_lyrics_controller.dart';

void main() {
  group('PlayerLyricsController.parseRawLyrics', () {
    test('parses multiple timestamps on one line and keeps results sorted', () {
      final controller = PlayerLyricsController();
      final lyrics = controller.parseRawLyrics(
        '[00:05.00]尾句\n'
        '[00:03.00][00:01.00]开场',
      );

      expect(lyrics, const [
        ParsedLyric(time: 1.0, text: '开场'),
        ParsedLyric(time: 3.0, text: '开场'),
        ParsedLyric(time: 5.0, text: '尾句'),
      ]);
    });

    test('merges near-duplicate timestamps into translation lines', () {
      final controller = PlayerLyricsController();
      final lyrics = controller.parseRawLyrics(
        '[00:10.00]Original line\n'
        '[00:10.20]Translated line\n'
        '[00:12.00]Next line',
      );

      expect(lyrics, const [
        ParsedLyric(
          time: 10.0,
          text: 'Original line',
          translation: 'Translated line',
        ),
        ParsedLyric(time: 12.0, text: 'Next line'),
      ]);
    });

    test('suppresses same-text duplicates at nearby timestamps', () {
      final controller = PlayerLyricsController();
      final lyrics = controller.parseRawLyrics(
        '[00:10.00]Original line\n'
        '[00:10.20]Original line\n'
        '[00:12.00]Next line',
      );

      expect(lyrics, const [
        ParsedLyric(time: 10.0, text: 'Original line'),
        ParsedLyric(time: 12.0, text: 'Next line'),
      ]);
    });

    test('suppresses extra nearby rows after attaching a translation', () {
      final controller = PlayerLyricsController();
      final lyrics = controller.parseRawLyrics(
        '[00:10.00]Original line\n'
        '[00:10.20]Translated line\n'
        '[00:10.30]Romanized line\n'
        '[00:12.00]Next line',
      );

      expect(lyrics, const [
        ParsedLyric(
          time: 10.0,
          text: 'Original line',
          translation: 'Translated line',
        ),
        ParsedLyric(time: 12.0, text: 'Next line'),
      ]);
    });

    test(
      'skips empty and malformed rows and falls back when nothing valid remains',
      () {
        final controller = PlayerLyricsController();

        expect(
          controller.parseRawLyrics(
            '[ti:Song Title]\n'
            '[00:01.00]   \n'
            'plain text\n'
            '[00:ab.cd]broken',
          ),
          const [ParsedLyric(time: 0, text: '暂无歌词')],
        );
      },
    );
  });

  group('PlayerLyricsController.buildLyrics', () {
    test('给真实歌词配上估算的逐字时间', () {
      final controller = PlayerLyricsController();
      final timeline = controller.buildLyrics(
        '[00:05.00]第一句\n'
        '[00:10.00]第二句',
      );

      expect(timeline.length, 2);
      expect(timeline[0].words.map((word) => word.text), <String>[
        '第',
        '一',
        '句',
      ]);
      expect(timeline[1].hasWords, isTrue);
    });

    test('解析不出歌词时不给哨兵行编逐字时间', () {
      final controller = PlayerLyricsController();
      final timeline = controller.buildLyrics('[ti:只有元数据]');

      expect(timeline.length, 1);
      expect(timeline[0].line.text, '暂无歌词');
      expect(timeline[0].words, isEmpty);
    });

    test('空串同样是哨兵行', () {
      final controller = PlayerLyricsController();
      expect(controller.buildLyrics('').lines.single.words, isEmpty);
    });

    test('同一份歌词重复取用命中缓存，换歌即失效', () {
      final controller = PlayerLyricsController();
      const raw = '[00:05.00]第一句\n[00:10.00]第二句';

      final first = controller.buildLyrics(raw);
      expect(identical(controller.buildLyrics(raw), first), isTrue);

      // 换歌：单条缓存作废，换回来是重新算的，但内容必须一致。
      final other = controller.buildLyrics('[00:05.00]别的歌');
      expect(other.lines.single.line.text, '别的歌');

      final again = controller.buildLyrics(raw);
      expect(identical(again, first), isFalse);
      expect(again.length, first.length);
      expect(again[0].line, first[0].line);
      expect(again[0].words, first[0].words);
    });

    test('解析结果也按原始串记忆化', () {
      final controller = PlayerLyricsController();
      const raw = '[00:05.00]第一句';

      expect(
        identical(controller.parseRawLyrics(raw), controller.parseRawLyrics(raw)),
        isTrue,
      );
    });
  });
}
