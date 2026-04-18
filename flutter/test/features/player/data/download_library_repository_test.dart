import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';

final class InMemoryDownloadRecordStore implements DownloadRecordStore {
  final List<DownloadRecord> records;

  InMemoryDownloadRecordStore(this.records);

  @override
  Future<DownloadRecord?> load({required String songKey, required String quality}) async {
    for (final record in records) {
      if (record.songKey == songKey && record.quality == quality) {
        return record;
      }
    }
    return null;
  }

  @override
  Future<List<DownloadRecord>> listAll() async => List<DownloadRecord>.from(records);

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async =>
      records.where((record) => record.songKey == songKey).toList(growable: false);

  @override
  Future<void> save(DownloadRecord record) async {}

  @override
  Future<void> remove({required String songKey, required String quality}) async {
    records.removeWhere((record) => record.songKey == songKey && record.quality == quality);
  }
}

void main() {
  test('download library repository lists downloads sorted by time and deletes records/files together', () async {
    final removedPaths = <String>[];
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      const DownloadRecord(
        songKey: 'netease:1',
        songId: '1',
        songName: '较早下载',
        artist: '歌手甲',
        quality: '320k',
        filePath: '/downloads/1.mp3',
        fileName: '1.mp3',
        downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
      ),
      const DownloadRecord(
        songKey: 'netease:2',
        songId: '2',
        songName: '较新下载',
        artist: '歌手乙',
        quality: 'flac',
        filePath: '/downloads/2.flac',
        fileName: '2.flac',
        downloadedAtIso8601: '2026-04-17T10:01:00.000Z',
      ),
    ]);
    final repository = DownloadLibraryRepository(
      recordStore: recordStore,
      fileExists: (path) async => true,
      deleteFile: (path) async {
        removedPaths.add(path);
      },
    );

    final items = await repository.listDownloads();
    expect(items.map((item) => item.songName), <String>['较新下载', '较早下载']);

    await repository.deleteDownload(songKey: 'netease:2', quality: 'flac', filePath: '/downloads/2.flac');

    expect(removedPaths, <String>['/downloads/2.flac']);
    expect(recordStore.records.map((record) => record.songKey), <String>['netease:1']);
  });

  test('download library repository removes malformed timestamps instead of throwing', () async {
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      const DownloadRecord(
        songKey: 'netease:bad',
        songId: 'bad',
        songName: '错误时间',
        artist: '歌手甲',
        quality: '320k',
        filePath: '/downloads/bad.mp3',
        fileName: 'bad.mp3',
        downloadedAtIso8601: 'not-a-date',
      ),
      const DownloadRecord(
        songKey: 'netease:good',
        songId: 'good',
        songName: '正常时间',
        artist: '歌手乙',
        quality: 'flac',
        filePath: '/downloads/good.flac',
        fileName: 'good.flac',
        downloadedAtIso8601: '2026-04-17T10:01:00.000Z',
      ),
    ]);
    final repository = DownloadLibraryRepository(
      recordStore: recordStore,
      fileExists: (path) async => true,
      deleteFile: (_) async {},
    );

    final items = await repository.listDownloads();

    expect(items.map((item) => item.songKey), <String>['netease:good']);
    expect(recordStore.records.map((record) => record.songKey), <String>['netease:good']);
  });

  test('download library repository removes the record when the file is already missing', () async {
    final removedPaths = <String>[];
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      const DownloadRecord(
        songKey: 'netease:missing',
        songId: 'missing',
        songName: '已丢失文件',
        artist: '歌手甲',
        quality: '320k',
        filePath: '/downloads/missing.mp3',
        fileName: 'missing.mp3',
        downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
      ),
    ]);
    final repository = DownloadLibraryRepository(
      recordStore: recordStore,
      fileExists: (path) async => false,
      deleteFile: (path) async {
        removedPaths.add(path);
      },
    );

    await repository.deleteDownload(
      songKey: 'netease:missing',
      quality: '320k',
      filePath: '/downloads/missing.mp3',
    );

    expect(removedPaths, isEmpty);
    expect(recordStore.records, isEmpty);
  });
}
