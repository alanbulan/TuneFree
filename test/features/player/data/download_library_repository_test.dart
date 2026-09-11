import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';

final class InMemoryDownloadRecordStore implements DownloadRecordStore {
  final List<DownloadRecord> records;

  InMemoryDownloadRecordStore(this.records);

  @override
  Future<DownloadRecord?> load({
    required String songKey,
    required String quality,
  }) async {
    for (final record in records) {
      if (record.songKey == songKey && record.quality == quality) {
        return record;
      }
    }
    return null;
  }

  @override
  Future<List<DownloadRecord>> listAll() async =>
      List<DownloadRecord>.from(records);

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async => records
      .where((record) => record.songKey == songKey)
      .toList(growable: false);

  @override
  Future<void> save(DownloadRecord record) async {
    records.removeWhere(
      (entry) =>
          entry.songKey == record.songKey && entry.quality == record.quality,
    );
    records.add(record);
  }

  @override
  Future<void> remove({
    required String songKey,
    required String quality,
  }) async {
    records.removeWhere(
      (record) => record.songKey == songKey && record.quality == quality,
    );
  }
}

/// 一个够用的假文件系统：只关心路径集合，以及挪动和删除的痕迹。
final class _FakeFiles {
  _FakeFiles(Iterable<String> paths) : _paths = <String>{...paths};

  final Set<String> _paths;
  final List<({String from, String to})> moves = <({String from, String to})>[];
  final List<String> deleted = <String>[];

  bool contains(String path) => _paths.contains(path);

  Future<bool> exists(String path) async => _paths.contains(path);

  Future<void> delete(String path) async {
    if (!_paths.contains(path)) {
      return;
    }
    deleted.add(path);
    _paths.remove(path);
  }

  Future<void> move({required String from, required String to}) async {
    if (!_paths.contains(from)) {
      return;
    }
    moves.add((from: from, to: to));
    _paths.remove(from);
    _paths.add(to);
  }

  Future<List<String>> list(String directory) async => _paths
      .where((path) => path.startsWith('$directory/'))
      .toList(growable: false);
}

const String _trashDirectory = '/trash';

DownloadLibraryRepository _repository(
  InMemoryDownloadRecordStore recordStore,
  _FakeFiles files,
) {
  return DownloadLibraryRepository(
    recordStore: recordStore,
    fileExists: files.exists,
    deleteFile: files.delete,
    trashDirectoryPath: () async => _trashDirectory,
    moveFile: files.move,
    listFiles: files.list,
  );
}

DownloadRecord _record({
  required String songKey,
  required String fileName,
  String quality = '320k',
  String downloadedAt = '2026-04-17T10:00:00.000Z',
  String? artworkUrl,
}) {
  return DownloadRecord(
    songKey: songKey,
    songId: songKey.split(':').last,
    songName: '歌曲 $songKey',
    artist: '歌手',
    quality: quality,
    filePath: '/downloads/$fileName',
    fileName: fileName,
    downloadedAtIso8601: downloadedAt,
    artworkUrl: artworkUrl,
  );
}

/// 造一个回收站条目名：`<删除时刻毫秒>__<原文件名>`。
String _trashName(DateTime deletedAt, String fileName) =>
    '$_trashDirectory/${deletedAt.millisecondsSinceEpoch}__$fileName';

void main() {
  test('列出下载按时间倒序，删除会把文件挪进回收站并摘掉记录', () async {
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      _record(songKey: 'netease:1', fileName: '1.mp3'),
      _record(
        songKey: 'netease:2',
        fileName: '2.flac',
        quality: 'flac',
        downloadedAt: '2026-04-17T10:01:00.000Z',
        artworkUrl: 'https://example.com/2.jpg',
      ),
    ]);
    final files = _FakeFiles(<String>['/downloads/1.mp3', '/downloads/2.flac']);
    final repository = _repository(recordStore, files);

    final items = await repository.listDownloads();
    expect(items.map((item) => item.songName), <String>[
      '歌曲 netease:2',
      '歌曲 netease:1',
    ]);
    expect(items.first.artworkUrl, 'https://example.com/2.jpg');

    final deleted = await repository.deleteDownload(
      songKey: 'netease:2',
      quality: 'flac',
      filePath: '/downloads/2.flac',
    );

    expect(deleted, isNotNull);
    expect(deleted!.originalFilePath, '/downloads/2.flac');
    expect(files.contains('/downloads/2.flac'), isFalse);
    expect(files.contains(deleted.trashedFilePath), isTrue);
    // 挪走而不是真删 —— 真删了就没得撤销了。
    expect(files.deleted, isEmpty);
    expect(recordStore.records.map((record) => record.songKey), <String>[
      'netease:1',
    ]);
  });

  test('撤销删除会把文件挪回原处，并把记录写回去', () async {
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      _record(songKey: 'netease:1', fileName: '1.mp3'),
    ]);
    final files = _FakeFiles(<String>['/downloads/1.mp3']);
    final repository = _repository(recordStore, files);

    final deleted = await repository.deleteDownload(
      songKey: 'netease:1',
      quality: '320k',
      filePath: '/downloads/1.mp3',
    );
    expect(recordStore.records, isEmpty);
    expect(await repository.listDownloads(), isEmpty);

    await repository.restoreDownload(deleted!);

    expect(files.contains('/downloads/1.mp3'), isTrue);
    expect(files.contains(deleted.trashedFilePath), isFalse);
    final restored = await repository.listDownloads();
    expect(restored.single.songName, '歌曲 netease:1');
  });

  test('文件本来就不在时没有可撤销的快照', () async {
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      _record(songKey: 'netease:missing', fileName: 'missing.mp3'),
    ]);
    final files = _FakeFiles(const <String>[]);
    final repository = _repository(recordStore, files);

    final deleted = await repository.deleteDownload(
      songKey: 'netease:missing',
      quality: '320k',
      filePath: '/downloads/missing.mp3',
    );

    expect(deleted, isNull);
    expect(files.moves, isEmpty);
    expect(files.deleted, isEmpty);
    expect(recordStore.records, isEmpty);
  });

  test('回收站里超过保留期的文件被清掉，新鲜的留下', () async {
    final now = DateTime.now();
    final stale = _trashName(now.subtract(const Duration(days: 8)), 'old.mp3');
    final fresh = _trashName(now.subtract(const Duration(days: 1)), 'new.mp3');
    // 名字里没有删除时刻的条目不是这里放进去的，不该被清。
    final unknown = '$_trashDirectory/说不清哪来的.mp3';

    final files = _FakeFiles(<String>[stale, fresh, unknown]);
    final repository = _repository(
      InMemoryDownloadRecordStore(<DownloadRecord>[]),
      files,
    );

    await repository.listDownloads();

    expect(files.deleted, <String>[stale]);
    expect(files.contains(fresh), isTrue);
    expect(files.contains(unknown), isTrue);
  });

  test('删除记录里时间戳坏掉的条目，而不是抛错', () async {
    final recordStore = InMemoryDownloadRecordStore(<DownloadRecord>[
      _record(
        songKey: 'netease:bad',
        fileName: 'bad.mp3',
        downloadedAt: 'not-a-date',
      ),
      _record(
        songKey: 'netease:good',
        fileName: 'good.flac',
        quality: 'flac',
        downloadedAt: '2026-04-17T10:01:00.000Z',
      ),
    ]);
    final files = _FakeFiles(<String>[
      '/downloads/bad.mp3',
      '/downloads/good.flac',
    ]);
    final repository = _repository(recordStore, files);

    final items = await repository.listDownloads();

    expect(items.map((item) => item.songKey), <String>['netease:good']);
    expect(recordStore.records.map((record) => record.songKey), <String>[
      'netease:good',
    ]);
  });
}
