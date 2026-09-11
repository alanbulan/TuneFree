import 'dart:io';

import 'package:path_provider/path_provider.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';

class DownloadFileTarget {
  const DownloadFileTarget({
    required this.fileName,
    required this.finalFile,
    required this.temporaryFile,
  });

  final String fileName;
  final File finalFile;
  final File temporaryFile;
}

class DownloadFileStore {
  DownloadFileStore._({
    required Directory rootDirectory,
    bool deleteRootOnDispose = false,
  }) : _rootDirectory = rootDirectory,
       _deleteRootOnDispose = deleteRootOnDispose;

  factory DownloadFileStore.real() {
    return DownloadFileStore._(rootDirectory: Directory('.'));
  }

  factory DownloadFileStore.test({required Directory rootDirectory}) {
    return DownloadFileStore._(
      rootDirectory: rootDirectory,
      deleteRootOnDispose: true,
    );
  }

  final Directory _rootDirectory;
  final bool _deleteRootOnDispose;

  Future<DownloadFileTarget> createTarget({
    required Song song,
    required AudioQuality quality,
  }) async {
    final audioDirectory = await _resolveAudioDirectory();
    await audioDirectory.create(recursive: true);
    final extension = _extensionFor(quality);
    final fileName = _buildFileName(song, extension);
    final finalFile = File('${audioDirectory.path}/$fileName');
    final temporaryFile = File('${finalFile.path}.download');
    return DownloadFileTarget(
      fileName: fileName,
      finalFile: finalFile,
      temporaryFile: temporaryFile,
    );
  }

  Future<void> deleteTemporaryFile(File file) async {
    if (await file.exists()) {
      await file.delete();
    }
  }

  Future<void> promoteTemporaryFile({
    required File temporaryFile,
    required File finalFile,
  }) async {
    if (await finalFile.exists()) {
      await finalFile.delete();
    }
    await temporaryFile.rename(finalFile.path);
  }

  Future<bool> fileExists(String path) async {
    return File(path).exists();
  }

  Future<void> deleteFinalFile(String path) async {
    final file = File(path);
    if (await file.exists()) {
      await file.delete();
    }
  }

  /// 回收站目录：删掉的下载先挪到这里，撤销时再挪回去。
  ///
  /// 和音频文件同在 `downloads/` 下，是为了保证两端在同一条文件系统上：
  /// 跨设备 `rename` 会失败，而退回复制会白白多写一份上百兆的文件。
  Future<String> trashDirectoryPath() async {
    return '${await _resolveDownloadsDirectory()}/trash';
  }

  Future<void> moveFile({required String from, required String to}) async {
    final source = File(from);
    if (!await source.exists()) {
      return;
    }
    final target = File(to);
    await target.parent.create(recursive: true);
    if (await target.exists()) {
      await target.delete();
    }
    await source.rename(to);
  }

  /// 列出一个目录下的全部文件。目录不存在时返回空列表 —— 首次删除之前
  /// 回收站是不存在的，那不算错误。
  Future<List<String>> listFiles(String directory) async {
    final directoryHandle = Directory(directory);
    if (!await directoryHandle.exists()) {
      return const <String>[];
    }
    return directoryHandle
        .listSync()
        .whereType<File>()
        .map((file) => file.path)
        .toList(growable: false);
  }

  Future<void> deleteTestRoot() async {
    if (_deleteRootOnDispose && await _rootDirectory.exists()) {
      await _rootDirectory.delete(recursive: true);
    }
  }

  Future<String> _resolveDownloadsDirectory() async {
    if (_deleteRootOnDispose) {
      return '${_rootDirectory.path}/downloads';
    }
    final documentsDirectory = await getApplicationDocumentsDirectory();
    return '${documentsDirectory.path}/downloads';
  }

  Future<Directory> _resolveAudioDirectory() async {
    return Directory('${await _resolveDownloadsDirectory()}/audio');
  }

  String _extensionFor(AudioQuality quality) {
    return switch (quality) {
      AudioQuality.k128 => 'mp3',
      AudioQuality.k320 => 'mp3',
      AudioQuality.flac => 'flac',
      AudioQuality.flac24bit => 'flac',
    };
  }

  String _buildFileName(Song song, String extension) {
    final artist = _sanitizeSegment(song.artist);
    final title = _sanitizeSegment(song.name);
    final source = _sanitizeSegment(song.source.wireValue);
    final id = _sanitizeSegment(song.id);
    return '$artist - $title [$source-$id].$extension';
  }

  String _sanitizeSegment(String value) {
    return value
        .replaceAll(RegExp(r'[\\/:*?"<>|]'), '_')
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
  }
}
