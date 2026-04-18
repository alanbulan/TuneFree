import 'download_record_store.dart';

class DownloadedTrackItem {
  const DownloadedTrackItem({
    required this.songKey,
    required this.songName,
    required this.artist,
    required this.quality,
    required this.fileName,
    required this.filePath,
    required this.downloadedAt,
    required this.exists,
  });

  final String songKey;
  final String songName;
  final String artist;
  final String quality;
  final String fileName;
  final String filePath;
  final DateTime downloadedAt;
  final bool exists;
}

class DownloadLibraryRepository {
  const DownloadLibraryRepository({
    required DownloadRecordStore recordStore,
    required Future<bool> Function(String path) fileExists,
    required Future<void> Function(String path) deleteFile,
  })  : _recordStore = recordStore,
        _fileExists = fileExists,
        _deleteFile = deleteFile;

  final DownloadRecordStore _recordStore;
  final Future<bool> Function(String path) _fileExists;
  final Future<void> Function(String path) _deleteFile;

  Future<List<DownloadedTrackItem>> listDownloads() async {
    final records = await _recordStore.listAll();
    final items = <DownloadedTrackItem>[];

    for (final record in records) {
      final downloadedAt = DateTime.tryParse(record.downloadedAtIso8601);
      if (downloadedAt == null) {
        await _recordStore.remove(songKey: record.songKey, quality: record.quality);
        continue;
      }

      final exists = await _safeFileExists(record.filePath);
      if (!exists) {
        await _recordStore.remove(songKey: record.songKey, quality: record.quality);
        continue;
      }

      items.add(
        DownloadedTrackItem(
          songKey: record.songKey,
          songName: record.songName,
          artist: record.artist,
          quality: record.quality,
          fileName: record.fileName,
          filePath: record.filePath,
          downloadedAt: downloadedAt,
          exists: true,
        ),
      );
    }

    items.sort((a, b) => b.downloadedAt.compareTo(a.downloadedAt));
    return items;
  }

  Future<void> deleteDownload({
    required String songKey,
    required String quality,
    required String filePath,
  }) async {
    final exists = await _safeFileExists(filePath);
    if (exists) {
      await _deleteFile(filePath);
    }
    await _recordStore.remove(songKey: songKey, quality: quality);
  }

  Future<bool> _safeFileExists(String path) async {
    try {
      return await _fileExists(path);
    } catch (_) {
      return false;
    }
  }
}
