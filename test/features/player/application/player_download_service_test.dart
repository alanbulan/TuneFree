import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/player_download_manager.dart';
import 'package:tunefree/features/player/data/player_download_service.dart';

void main() {
  test(
    'download service forwards real download results through its public API',
    () async {
      final service = PlayerDownloadService.test(
        download: (song, quality) async => DownloadResult(
          song: song,
          quality: quality,
          fileName: '马也_Crabbit - 海与你 [netease-download-song].flac',
          filePath: '/downloads/song.flac',
          alreadyExisted: false,
        ),
      );
      const song = Song(
        id: 'download-song',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      );

      final result = await service.downloadSong(song, AudioQuality.flac);

      expect(result.fileName, '马也_Crabbit - 海与你 [netease-download-song].flac');
      expect(result.filePath, '/downloads/song.flac');
      expect(result.alreadyExisted, isFalse);
    },
  );
}
