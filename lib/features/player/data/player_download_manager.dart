import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'download_file_store.dart';
import 'download_record.dart';
import 'download_record_store.dart';
import 'song_resolution_repository.dart';

class DownloadResult {
  const DownloadResult({
    required this.song,
    required this.quality,
    required this.fileName,
    required this.filePath,
    required this.alreadyExisted,
  });

  final Song song;
  final AudioQuality quality;
  final String fileName;
  final String filePath;
  final bool alreadyExisted;
}

class PlayerDownloadManager {
  const PlayerDownloadManager({
    required Future<List<int>> Function(String url) httpBytes,
    required DownloadFileStore fileStore,
    required DownloadRecordStore recordStore,
    required SongResolutionRepository songResolutionRepository,
  }) : _httpBytes = httpBytes,
       _fileStore = fileStore,
       _recordStore = recordStore,
       _songResolutionRepository = songResolutionRepository;

  final Future<List<int>> Function(String url) _httpBytes;
  final DownloadFileStore _fileStore;
  final DownloadRecordStore _recordStore;
  final SongResolutionRepository _songResolutionRepository;

  Future<DownloadResult> downloadSong(Song song, AudioQuality quality) async {
    final resolvedSong = await _resolveSongIfNeeded(song, quality);

    final existingRecord = await _recordStore.load(
      songKey: resolvedSong.key,
      quality: quality.wireValue,
    );
    if (existingRecord != null) {
      return DownloadResult(
        song: resolvedSong,
        quality: quality,
        fileName: existingRecord.fileName,
        filePath: existingRecord.filePath,
        alreadyExisted: true,
      );
    }

    final url = resolvedSong.url;
    if (url == null || url.isEmpty) {
      throw StateError('download URL missing after resolution');
    }

    final target = await _fileStore.createTarget(
      song: resolvedSong,
      quality: quality,
    );
    try {
      final bytes = await _httpBytes(url);
      await target.temporaryFile.writeAsBytes(bytes, flush: true);
      await _fileStore.promoteTemporaryFile(
        temporaryFile: target.temporaryFile,
        finalFile: target.finalFile,
      );
      final record = DownloadRecord(
        songKey: resolvedSong.key,
        songId: resolvedSong.id,
        songName: resolvedSong.name,
        artist: resolvedSong.artist,
        quality: quality.wireValue,
        filePath: target.finalFile.path,
        fileName: target.fileName,
        downloadedAtIso8601: DateTime.now().toUtc().toIso8601String(),
      );
      try {
        await _recordStore.save(record);
      } catch (_) {
        if (await target.finalFile.exists()) {
          await target.finalFile.delete();
        }
        rethrow;
      }

      return DownloadResult(
        song: resolvedSong,
        quality: quality,
        fileName: target.fileName,
        filePath: target.finalFile.path,
        alreadyExisted: false,
      );
    } catch (_) {
      await _fileStore.deleteTemporaryFile(target.temporaryFile);
      rethrow;
    }
  }

  Future<Song> _resolveSongIfNeeded(Song song, AudioQuality quality) {
    final url = song.url;
    if (url != null && url.isNotEmpty) {
      return Future<Song>.value(song);
    }
    return _songResolutionRepository.resolveSong(
      song,
      quality: quality.wireValue,
    );
  }
}
