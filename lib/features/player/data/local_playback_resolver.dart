import 'dart:io';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import 'download_record.dart';

class LocalPlaybackMatch {
  const LocalPlaybackMatch({required this.song, required this.filePath});

  final Song song;
  final String filePath;
}

class LocalPlaybackResolver {
  const LocalPlaybackResolver({
    required Future<List<DownloadRecord>> Function(String songKey)
    recordsForSong,
    required Future<bool> Function(String path) fileExists,
    required Future<void> Function({
      required String songKey,
      required String quality,
    })
    removeRecord,
  }) : _recordsForSong = recordsForSong,
       _fileExists = fileExists,
       _removeRecord = removeRecord;

  final Future<List<DownloadRecord>> Function(String songKey) _recordsForSong;
  final Future<bool> Function(String path) _fileExists;
  final Future<void> Function({
    required String songKey,
    required String quality,
  })
  _removeRecord;

  Future<LocalPlaybackMatch?> resolve(Song song, AudioQuality quality) async {
    final records = await _recordsForSong(song.key);
    for (final record in records) {
      if (record.quality != quality.wireValue) {
        continue;
      }

      if (!await _fileExists(record.filePath)) {
        await _removeRecord(songKey: record.songKey, quality: record.quality);
        return null;
      }

      return LocalPlaybackMatch(
        song: song.copyWith(
          url: Uri.file(
            record.filePath,
            windows: Platform.isWindows,
          ).toString(),
        ),
        filePath: record.filePath,
      );
    }
    return null;
  }

  Future<void> remove(Song song, AudioQuality quality) {
    return _removeRecord(songKey: song.key, quality: quality.wireValue);
  }
}
