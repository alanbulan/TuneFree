import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';

final class InMemoryDownloadLibraryRepository implements DownloadLibraryRepository {
  InMemoryDownloadLibraryRepository();

  final List<DownloadedTrackItem> records = <DownloadedTrackItem>[];

  @override
  Future<void> deleteDownload({
    required String songKey,
    required String quality,
    required String filePath,
  }) async {
    records.removeWhere(
      (record) =>
          record.songKey == songKey &&
          record.quality == quality &&
          record.filePath == filePath,
    );
  }

  @override
  Future<List<DownloadedTrackItem>> listDownloads() async => List<DownloadedTrackItem>.from(records);
}

final class InMemoryLibraryStorage implements LibraryStorage {
  InMemoryLibraryStorage({this.favoritesSaveCompleter});

  final Completer<void>? favoritesSaveCompleter;

  String apiKey = '';
  String corsProxy = '';
  String apiBase = 'https://example.com';
  List<Song> favorites = <Song>[];
  List<Playlist> playlists = <Playlist>[];

  @override
  Future<String> loadApiBase() async => apiBase;

  @override
  Future<String> loadApiKey() async => apiKey;

  @override
  Future<String> loadCorsProxy() async => corsProxy;

  @override
  Future<List<Song>> loadFavorites() async => favorites;

  @override
  Future<List<Playlist>> loadPlaylists() async => playlists;

  @override
  Future<void> saveApiBase(String value) async => apiBase = value;

  @override
  Future<void> saveApiKey(String value) async => apiKey = value;

  @override
  Future<void> saveCorsProxy(String value) async => corsProxy = value;

  @override
  Future<LibraryBackupData> loadBackupData() async {
    return LibraryBackupData(
      favorites: favorites,
      playlists: playlists,
      apiKey: apiKey,
      corsProxy: corsProxy,
      apiBase: apiBase,
    );
  }

  @override
  Future<void> saveBackupData(LibraryBackupData value) async {
    favorites = value.favorites;
    playlists = value.playlists;
    apiKey = value.apiKey;
    corsProxy = value.corsProxy;
    apiBase = value.apiBase;
  }

  @override
  Future<void> saveFavorites(List<Song> values) async {
    final completer = favoritesSaveCompleter;
    if (completer != null) {
      await completer.future;
    }
    favorites = values;
  }

  @override
  Future<void> savePlaylists(List<Playlist> values) async => playlists = values;
}

void main() {
  test('setters persist loaded library config values', () async {
    final storage = InMemoryLibraryStorage();
    final repository = InMemoryDownloadLibraryRepository();
    final controller = LibraryController(storage: storage, downloadLibraryRepository: repository);
    await controller.load();

    await controller.setApiKey('secret-key');
    await controller.setCorsProxy('https://proxy.example.com');
    await controller.setApiBase('https://api.example.com');

    expect(controller.state.apiKey, 'secret-key');
    expect(controller.state.corsProxy, 'https://proxy.example.com');
    expect(controller.state.apiBase, 'https://api.example.com');
    expect(storage.apiKey, 'secret-key');
    expect(storage.corsProxy, 'https://proxy.example.com');
    expect(storage.apiBase, 'https://api.example.com');
  });

  test('toggleFavorite awaits favorite persistence before updating state', () async {
    final completer = Completer<void>();
    final storage = InMemoryLibraryStorage(favoritesSaveCompleter: completer);
    final repository = InMemoryDownloadLibraryRepository();
    final controller = LibraryController(
      storage: storage,
      downloadLibraryRepository: repository,
    );
    await controller.load();

    const song = Song(
      id: 'fav-1',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    final future = controller.toggleFavorite(song);

    expect(controller.state.favorites, isEmpty);
    expect(storage.favorites, isEmpty);

    completer.complete();
    await future;

    expect(controller.state.favorites.single.key, 'netease:fav-1');
    expect(storage.favorites.single.key, 'netease:fav-1');
  });

  test('playlist CRUD mirrors legacy library behavior', () async {
    final storage = InMemoryLibraryStorage();
    final repository = InMemoryDownloadLibraryRepository();
    final controller = LibraryController(
      storage: storage,
      downloadLibraryRepository: repository,
    );
    await controller.load();

    const song = Song(
      id: 'fav-1',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    await controller.createPlaylist('我的歌单');
    expect(controller.state.playlists.single.name, '我的歌单');

    final playlistId = controller.state.playlists.single.id;
    await controller.addToPlaylist(playlistId, song);
    expect(controller.state.playlists.single.songs.single.key, 'netease:fav-1');

    await controller.renamePlaylist(playlistId, '已重命名');
    expect(controller.state.playlists.single.name, '已重命名');
  });

  test('createPlaylist trims names before persisting them', () async {
    final storage = InMemoryLibraryStorage();
    final repository = InMemoryDownloadLibraryRepository();
    final controller = LibraryController(
      storage: storage,
      downloadLibraryRepository: repository,
    );
    await controller.load();

    await controller.createPlaylist('  我的歌单  ');

    expect(controller.state.playlists.single.name, '我的歌单');
    expect(storage.playlists.single.name, '我的歌单');
  });
}
