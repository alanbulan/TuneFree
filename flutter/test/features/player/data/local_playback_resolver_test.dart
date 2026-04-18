import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/local_playback_resolver.dart';

void main() {
  test(
    'local playback resolver returns an exact-quality local hit only',
    () async {
      final resolver = LocalPlaybackResolver(
        recordsForSong: (songKey) async => <DownloadRecord>[
          const DownloadRecord(
            songKey: 'netease:download-song',
            songId: 'download-song',
            songName: '海与你',
            artist: '马也_Crabbit',
            quality: 'flac',
            filePath: '/downloads/song.flac',
            fileName: 'song.flac',
            downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
          ),
        ],
        fileExists: (path) async => path == '/downloads/song.flac',
        removeRecord: ({required songKey, required quality}) async {},
      );

      const song = Song(
        id: 'download-song',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      );

      final flacHit = await resolver.resolve(song, AudioQuality.flac);
      expect(flacHit?.filePath, '/downloads/song.flac');

      final mp3Miss = await resolver.resolve(song, AudioQuality.k320);
      expect(mp3Miss, isNull);
    },
  );

  test(
    'local playback resolver removes stale exact-quality records when the file is missing',
    () async {
      final removed = <String>[];
      final resolver = LocalPlaybackResolver(
        recordsForSong: (songKey) async => <DownloadRecord>[
          const DownloadRecord(
            songKey: 'netease:download-song',
            songId: 'download-song',
            songName: '海与你',
            artist: '马也_Crabbit',
            quality: 'flac',
            filePath: '/downloads/missing.flac',
            fileName: 'missing.flac',
            downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
          ),
        ],
        fileExists: (path) async => false,
        removeRecord: ({required songKey, required quality}) async {
          removed.add('$songKey::$quality');
        },
      );

      const song = Song(
        id: 'download-song',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      );

      final result = await resolver.resolve(song, AudioQuality.flac);

      expect(result, isNull);
      expect(removed, <String>['netease:download-song::flac']);
    },
  );

  test('local playback resolver can remove a record explicitly', () async {
    final removed = <String>[];
    final resolver = LocalPlaybackResolver(
      recordsForSong: (songKey) async => const <DownloadRecord>[],
      fileExists: (path) async => true,
      removeRecord: ({required songKey, required quality}) async {
        removed.add('$songKey::$quality');
      },
    );

    const song = Song(
      id: 'download-song',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    await resolver.remove(song, AudioQuality.flac);

    expect(removed, <String>['netease:download-song::flac']);
  });
}
