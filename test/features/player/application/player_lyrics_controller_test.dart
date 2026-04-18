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
        ParsedLyric(time: 10.0, text: 'Original line', translation: 'Translated line'),
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
        ParsedLyric(time: 10.0, text: 'Original line', translation: 'Translated line'),
        ParsedLyric(time: 12.0, text: 'Next line'),
      ]);
    });

    test('skips empty and malformed rows and falls back when nothing valid remains', () {
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
    });
  });

  test('findActiveIndex matches the legacy hook behavior', () {
    final controller = PlayerLyricsController();
    final lyrics = const [
      ParsedLyric(time: 1.0, text: '第一句'),
      ParsedLyric(time: 3.5, text: '第二句'),
    ];

    expect(controller.findActiveIndex(lyrics, 0.5), 0);
    expect(controller.findActiveIndex(lyrics, 3.6), 1);
  });
}
