import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3 把 ChangeNotifierProvider 移出了主流出口，只在 legacy.dart 里提供。
import 'package:flutter_riverpod/legacy.dart';

import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';
import '../../player/data/download_library_repository.dart';
import '../../player/data/player_download_service.dart';
import '../data/library_storage.dart';
import 'library_state.dart';

final libraryStorageProvider = Provider<LibraryStorage>((ref) {
  return SharedPreferencesLibraryStorage();
});

final downloadLibraryRepositoryProvider = Provider<DownloadLibraryRepository>((
  ref,
) {
  final fileStore = ref.watch(downloadFileStoreProvider);
  final recordStore = ref.watch(downloadRecordStoreProvider);
  return DownloadLibraryRepository(
    recordStore: recordStore,
    fileExists: fileStore.fileExists,
    deleteFile: fileStore.deleteFinalFile,
    trashDirectoryPath: fileStore.trashDirectoryPath,
    moveFile: fileStore.moveFile,
    listFiles: fileStore.listFiles,
  );
});

final libraryControllerProvider = ChangeNotifierProvider<LibraryController>((
  ref,
) {
  final controller = LibraryController(
    storage: ref.watch(libraryStorageProvider),
    downloadLibraryRepository: ref.watch(downloadLibraryRepositoryProvider),
  );
  controller.load();
  return controller;
});

final class LibraryController extends ChangeNotifier {
  LibraryController({
    required LibraryStorage storage,
    required DownloadLibraryRepository downloadLibraryRepository,
  }) : _storage = storage,
       _downloadLibraryRepository = downloadLibraryRepository;

  final LibraryStorage _storage;
  final DownloadLibraryRepository _downloadLibraryRepository;

  LibraryState _state = const LibraryState();
  LibraryState get state => _state;

  Future<void> load() async {
    _state = _state.copyWith(
      favorites: await _storage.loadFavorites(),
      playlists: await _storage.loadPlaylists(),
      corsProxy: await _storage.loadCorsProxy(),
      downloads: await _downloadLibraryRepository.listDownloads(),
      isLoaded: true,
    );
    notifyListeners();
  }

  bool isFavoriteSong(Song song) {
    return _state.favorites.any((item) => item.key == song.key);
  }

  Future<void> toggleFavorite(Song song) async {
    final exists = isFavoriteSong(song);
    final nextFavorites = exists
        ? _state.favorites
              .where((item) => item.key != song.key)
              .toList(growable: false)
        : <Song>[song, ..._state.favorites];
    await _storage.saveFavorites(nextFavorites);
    _state = _state.copyWith(favorites: nextFavorites);
    notifyListeners();
  }

  Future<Playlist> createPlaylist(
    String name, {
    List<Song> initialSongs = const <Song>[],
  }) async {
    final trimmedName = name.trim();
    final now = DateTime.now().millisecondsSinceEpoch;
    final playlist = Playlist(
      id: now.toString(),
      name: trimmedName,
      createTime: now,
      songs: List<Song>.unmodifiable(initialSongs),
    );
    final playlists = <Playlist>[playlist, ..._state.playlists];
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
    return playlist;
  }

  Future<void> renamePlaylist(String id, String name) async {
    final playlists = _state.playlists
        .map(
          (playlist) =>
              playlist.id == id ? playlist.copyWith(name: name) : playlist,
        )
        .toList(growable: false);
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  Future<void> deletePlaylist(String id) async {
    final playlists = _state.playlists
        .where((playlist) => playlist.id != id)
        .toList(growable: false);
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  Future<void> addToPlaylist(String playlistId, Song song) async {
    final playlists = _state.playlists
        .map((playlist) {
          if (playlist.id != playlistId) {
            return playlist;
          }
          if (playlist.songs.any((item) => item.key == song.key)) {
            return playlist;
          }
          return playlist.copyWith(songs: <Song>[...playlist.songs, song]);
        })
        .toList(growable: false);
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  Future<void> removeFromPlaylist(String playlistId, Song song) async {
    final playlists = _state.playlists
        .map((playlist) {
          if (playlist.id != playlistId) {
            return playlist;
          }
          return playlist.copyWith(
            songs: playlist.songs
                .where((item) => item.key != song.key)
                .toList(growable: false),
          );
        })
        .toList(growable: false);
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  /// 用一份歌单快照覆盖当前状态，供「撤销删除」与「撤销移除歌曲」共用。
  ///
  /// 列表里已有同 id 就原位覆盖，没有就按 [index] 插回去 —— 删除和移除
  /// 因此走同一条路径。**不能复用 `createPlaylist`**：它自己铸新 id，
  /// 撤销出来的会是一个「另一张」歌单，页面上的选中态和引用全断。
  Future<void> restorePlaylist(Playlist snapshot, {int index = 0}) async {
    final existingIndex = _state.playlists.indexWhere(
      (playlist) => playlist.id == snapshot.id,
    );
    final playlists = <Playlist>[..._state.playlists];
    if (existingIndex >= 0) {
      playlists[existingIndex] = snapshot;
    } else {
      playlists.insert(index.clamp(0, playlists.length), snapshot);
    }
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  Future<void> setCorsProxy(String value) async {
    await _storage.saveCorsProxy(value);
    _state = _state.copyWith(corsProxy: value);
    notifyListeners();
  }

  /// 只负责生成 JSON，不改状态。
  ///
  /// 「最近导出」必须等文件真的交出去之后再记录：以前这里顺手就写了状态，
  /// 于是传输失败时（比如平台不支持）用户会同时看到预览卡和错误提示。
  Future<String> exportBackupJson() async {
    final backup = await _storage.loadBackupData();
    return const JsonEncoder.withIndent('  ').convert(backup.toJson());
  }

  /// 导出成功送达后记一笔，供「最近导出」卡展示。
  void markBackupExported(String jsonText) {
    _state = _state.copyWith(exportedBackupJson: jsonText);
    notifyListeners();
  }

  /// 导入是**整体替换**，没有合并模式。
  ///
  /// 返回替换**之前**的快照，调用方据此在提示条上提供撤销 —— 这是一次会抹掉
  /// 全部收藏与歌单的操作，只给一次机会而没有退路太狠了。
  Future<LibraryBackupData> importBackupJson(String rawJson) async {
    final decoded = jsonDecode(rawJson);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('backup payload must be an object');
    }

    final backup = LibraryBackupData.fromJson(decoded);
    final previous = await _storage.loadBackupData();
    await _storage.saveBackupData(backup);
    _state = _state.copyWith(
      favorites: backup.favorites,
      playlists: backup.playlists,
      corsProxy: backup.corsProxy,
      exportedBackupJson: null,
      lastImportSummary:
          '已导入 ${backup.favorites.length} 首收藏和 ${backup.playlists.length} 个歌单',
    );
    await refreshDownloads();
    notifyListeners();
    return previous;
  }

  /// 撤销一次导入：把资料库还原成导入前的快照。
  Future<void> restoreBackup(LibraryBackupData backup) async {
    await _storage.saveBackupData(backup);
    _state = _state.copyWith(
      favorites: backup.favorites,
      playlists: backup.playlists,
      corsProxy: backup.corsProxy,
      exportedBackupJson: null,
      lastImportSummary: '已撤销导入',
    );
    await refreshDownloads();
    notifyListeners();
  }

  void setDownloadFilter(String value) {
    _state = _state.copyWith(downloadFilter: value);
    notifyListeners();
  }

  Future<void> refreshDownloads() async {
    _state = _state.copyWith(
      downloads: await _downloadLibraryRepository.listDownloads(),
    );
    notifyListeners();
  }

  /// 删除一首已下载的歌，返回撤销所需的快照。
  ///
  /// 文件是被挪进回收站的，不是真删 —— 所以这个操作是可逆的。
  /// 文件本来就不在时返回 null。
  Future<DeletedDownload?> deleteDownload(DownloadedTrackItem item) async {
    final deleted = await _downloadLibraryRepository.deleteDownload(
      songKey: item.songKey,
      quality: item.quality,
      filePath: item.filePath,
    );
    await refreshDownloads();
    return deleted;
  }

  /// 撤销一批删除。下载页是多选删除，撤销也得整批回滚 —— 只恢复其中几首
  /// 会让用户以为全回来了。
  Future<void> restoreDownloads(List<DeletedDownload> deleted) async {
    for (final entry in deleted) {
      await _downloadLibraryRepository.restoreDownload(entry);
    }
    await refreshDownloads();
  }
}
