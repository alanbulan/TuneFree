import 'dart:async';

import 'download_record.dart';
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
    this.artworkUrl,
  });

  final String songKey;
  final String songName;
  final String artist;
  final String quality;
  final String fileName;
  final String filePath;
  final DateTime downloadedAt;
  final bool exists;
  final String? artworkUrl;
}

/// 一次删除的快照 —— 有它才能撤销。
///
/// 文件是被**挪进回收站**而不是直接删掉的，[trashedFilePath] 是它现在的落点。
/// [record] 是删除时一并摘掉的那条下载记录：撤销时要原样写回去，否则文件
/// 回来了却不出现在下载列表里 —— 那比不能撤销更让人困惑。
final class DeletedDownload {
  const DeletedDownload({
    required this.record,
    required this.originalFilePath,
    required this.trashedFilePath,
  });

  final DownloadRecord record;
  final String originalFilePath;
  final String trashedFilePath;
}

/// 回收站里的文件按 `<删除时刻毫秒>__<原文件名>` 命名。
///
/// 时刻写进**文件名**而不是靠文件的 mtime：`rename` 会保留原文件的修改时间，
/// 一份半年前下载的歌今天被删掉，按 mtime 算会立刻被当成过期条目清掉 ——
/// 撤销就没了。
const String _trashNameSeparator = '__';

/// 回收站保留时长。超过就真删，与桌面系统的回收站同一个思路。
const Duration _trashMaxAge = Duration(days: 7);

class DownloadLibraryRepository {
  const DownloadLibraryRepository({
    required DownloadRecordStore recordStore,
    required Future<bool> Function(String path) fileExists,
    required Future<void> Function(String path) deleteFile,
    required Future<String> Function() trashDirectoryPath,
    required Future<void> Function({required String from, required String to})
    moveFile,
    required Future<List<String>> Function(String directory) listFiles,
  }) : _recordStore = recordStore,
       _fileExists = fileExists,
       _deleteFile = deleteFile,
       _trashDirectoryPath = trashDirectoryPath,
       _moveFile = moveFile,
       _listFiles = listFiles;

  final DownloadRecordStore _recordStore;
  final Future<bool> Function(String path) _fileExists;
  final Future<void> Function(String path) _deleteFile;
  final Future<String> Function() _trashDirectoryPath;
  final Future<void> Function({required String from, required String to})
  _moveFile;
  final Future<List<String>> Function(String directory) _listFiles;

  Future<List<DownloadedTrackItem>> listDownloads() async {
    // 顺手清一次过期的回收站条目。放在这里是因为它是唯一一个「打开下载页
    // 就一定走到」的入口，不需要再挂一个启动任务。
    //
    // **不 await**，两个理由：
    // - 清理是后台琐事，不该拦在列表前面。回收站攒得多的时候它是一次目录
    //   扫描加若干次删除，让用户等着它跑完再看见列表没有道理。
    // - 它的第一步就要 `path_provider`。widget 测试里那条通道没有实现，
    //   在 `testWidgets` 的 fake async 区里**永远不会完成**（既不成功也不
    //   抛错，实测如此），await 住就会把 `LibraryController.load()` 一起挂住，
    //   页面停在加载态、`pumpAndSettle` 转到超时。取消 await 之后实测
    //   `pumpAndSettle` 正常返回。
    unawaited(purgeTrash());

    final records = await _recordStore.listAll();
    final items = <DownloadedTrackItem>[];

    for (final record in records) {
      final downloadedAt = DateTime.tryParse(record.downloadedAtIso8601);
      if (downloadedAt == null) {
        await _recordStore.remove(
          songKey: record.songKey,
          quality: record.quality,
        );
        continue;
      }

      final exists = await _safeFileExists(record.filePath);
      if (!exists) {
        await _recordStore.remove(
          songKey: record.songKey,
          quality: record.quality,
        );
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
          artworkUrl: record.artworkUrl,
        ),
      );
    }

    items.sort((a, b) => b.downloadedAt.compareTo(a.downloadedAt));
    return items;
  }

  /// 删除一首已下载的歌。
  ///
  /// 返回撤销所需的快照；文件本来就不在时返回 null（那也没什么可撤销的）。
  Future<DeletedDownload?> deleteDownload({
    required String songKey,
    required String quality,
    required String filePath,
  }) async {
    // 先把记录取出来再动文件：`load` 会校验文件存在，挪走之后就取不到了。
    final record = await _recordStore.load(songKey: songKey, quality: quality);

    DeletedDownload? snapshot;
    if (record != null && await _safeFileExists(filePath)) {
      final trashedFilePath = await _trashPathFor(filePath);
      await _moveFile(from: filePath, to: trashedFilePath);
      snapshot = DeletedDownload(
        record: record,
        originalFilePath: filePath,
        trashedFilePath: trashedFilePath,
      );
    }

    await _recordStore.remove(songKey: songKey, quality: quality);
    return snapshot;
  }

  /// 撤销一次删除：把文件挪回原处，并把下载记录写回去。
  ///
  /// 挪不回去（回收站被系统清了、路径被占用）也不抛错 —— 下面的
  /// [listDownloads] 会把指向不存在文件的记录清掉，列表不会留下幽灵条目。
  Future<void> restoreDownload(DeletedDownload deleted) async {
    await _moveFile(
      from: deleted.trashedFilePath,
      to: deleted.originalFilePath,
    );
    await _recordStore.save(deleted.record);
  }

  /// 清掉回收站里超过 [maxAge] 的文件，返回清掉的数量。
  ///
  /// **整件事是尽力而为的**：回收站目录取不到（比如平台通道不可用）、目录读不了、
  /// 单个文件删不掉，都只算「这次没清成」。清理是顺手做的事，不是列下载的前置
  /// 条件 —— 让它把 [listDownloads] 带崩，下载页就会卡在加载态出不来。
  ///
  /// 名字解析不出删除时刻的文件**不动**：那说明它不是这里放进去的，
  /// 与其猜一个时间删掉，不如留着。
  Future<int> purgeTrash({Duration maxAge = _trashMaxAge}) async {
    try {
      final directory = await _trashDirectoryPath();
      final paths = await _listFiles(directory);
      if (paths.isEmpty) {
        return 0;
      }

      final cutoff = DateTime.now().subtract(maxAge).millisecondsSinceEpoch;
      var removed = 0;
      for (final path in paths) {
        final deletedAt = _deletedAtOf(path);
        if (deletedAt == null || deletedAt.millisecondsSinceEpoch >= cutoff) {
          continue;
        }
        await _deleteFile(path);
        removed += 1;
      }
      return removed;
    } catch (_) {
      return 0;
    }
  }

  Future<String> _trashPathFor(String filePath) async {
    final directory = await _trashDirectoryPath();
    final stamp = DateTime.now().millisecondsSinceEpoch;
    return '$directory/$stamp$_trashNameSeparator${_baseNameOf(filePath)}';
  }

  DateTime? _deletedAtOf(String path) {
    final name = _baseNameOf(path);
    final separatorIndex = name.indexOf(_trashNameSeparator);
    if (separatorIndex <= 0) {
      return null;
    }
    final stamp = int.tryParse(name.substring(0, separatorIndex));
    return stamp == null ? null : DateTime.fromMillisecondsSinceEpoch(stamp);
  }

  String _baseNameOf(String path) => path.split(RegExp(r'[\\/]')).last;

  Future<bool> _safeFileExists(String path) async {
    try {
      return await _fileExists(path);
    } catch (_) {
      return false;
    }
  }
}
