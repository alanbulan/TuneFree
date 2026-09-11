import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';

final class InMemoryDownloadLibraryRepository
    implements DownloadLibraryRepository {
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
  Future<List<DownloadedTrackItem>> listDownloads() async =>
      List<DownloadedTrackItem>.from(records);
}

final class InMemoryLibraryStorage implements LibraryStorage {
  InMemoryLibraryStorage({this.favoritesSaveCompleter});

  final Completer<void>? favoritesSaveCompleter;

  String corsProxy = '';
  List<Song> favorites = <Song>[];
  List<Playlist> playlists = <Playlist>[];

  @override
  Future<String> loadCorsProxy() async => corsProxy;

  @override
  Future<List<Song>> loadFavorites() async => favorites;

  @override
  Future<List<Playlist>> loadPlaylists() async => playlists;

  @override
  Future<void> saveCorsProxy(String value) async => corsProxy = value;

  @override
  Future<LibraryBackupData> loadBackupData() async {
    return LibraryBackupData(
      favorites: favorites,
      playlists: playlists,
      corsProxy: corsProxy,
    );
  }

  @override
  Future<void> saveBackupData(LibraryBackupData value) async {
    favorites = value.favorites;
    playlists = value.playlists;
    corsProxy = value.corsProxy;
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
  test('shared preferences storage starts empty on first load', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final storage = SharedPreferencesLibraryStorage();

    expect(await storage.loadFavorites(), isEmpty);
    expect(await storage.loadPlaylists(), isEmpty);
    expect(await storage.loadCorsProxy(), isEmpty);
  });

  test(
    'shared preferences storage persists library data across instances',
    () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      const song = Song(
        id: 'fav-1',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      );
      const playlist = Playlist(
        id: 'playlist-1',
        name: '收藏歌单',
        createTime: 1713200000000,
        songs: <Song>[song],
      );

      final firstStorage = SharedPreferencesLibraryStorage();
      await firstStorage.saveFavorites(<Song>[song]);
      await firstStorage.savePlaylists(<Playlist>[playlist]);
      await firstStorage.saveCorsProxy('https://proxy.example.com');

      final secondStorage = SharedPreferencesLibraryStorage();
      expect((await secondStorage.loadFavorites()).single.key, 'netease:fav-1');
      expect((await secondStorage.loadPlaylists()).single.name, '收藏歌单');
      expect(await secondStorage.loadCorsProxy(), 'https://proxy.example.com');
    },
  );

  test('shared preferences storage ignores corrupt JSON', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'tunefree_favorites': 'not-json',
      'tunefree_playlists': '[{"missingRequiredFields": true}]',
    });
    final storage = SharedPreferencesLibraryStorage();

    expect(await storage.loadFavorites(), isEmpty);
    expect(await storage.loadPlaylists(), isEmpty);
  });

  test('setters persist loaded library config values', () async {
    final storage = InMemoryLibraryStorage();
    final repository = InMemoryDownloadLibraryRepository();
    final controller = LibraryController(
      storage: storage,
      downloadLibraryRepository: repository,
    );
    await controller.load();

    await controller.setCorsProxy('https://proxy.example.com');

    expect(controller.state.corsProxy, 'https://proxy.example.com');
    expect(storage.corsProxy, 'https://proxy.example.com');
  });

  test(
    'toggleFavorite awaits favorite persistence before updating state',
    () async {
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
    },
  );

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

  test(
    'importBackupJson replaces the library and returns a restorable snapshot',
    () async {
      const original = Song(
        id: 'fav-1',
        name: '原有收藏',
        artist: '原有歌手',
        source: MusicSource.netease,
      );
      final storage = InMemoryLibraryStorage()
        ..favorites = <Song>[original]
        ..corsProxy = 'https://old.example.com';
      final repository = InMemoryDownloadLibraryRepository();
      final controller = LibraryController(
        storage: storage,
        downloadLibraryRepository: repository,
      );
      await controller.load();

      final previous = await controller.importBackupJson(
        jsonEncode(<String, dynamic>{
          'favorites': <Map<String, dynamic>>[
            <String, dynamic>{
              'id': 'imported-1',
              'name': '导入收藏曲',
              'artist': '备份歌手',
              'source': 'kuwo',
            },
          ],
          'playlists': <Map<String, dynamic>>[],
          'corsProxy': 'https://new.example.com',
        }),
      );

      // 导入是整体替换。
      expect(controller.state.favorites.single.name, '导入收藏曲');
      expect(controller.state.corsProxy, 'https://new.example.com');
      // 返回的快照必须是替换「之前」的样子 —— 撤销提示条全靠它。
      expect(previous.favorites.single.name, '原有收藏');
      expect(previous.corsProxy, 'https://old.example.com');

      await controller.restoreBackup(previous);

      expect(controller.state.favorites.single.name, '原有收藏');
      expect(controller.state.corsProxy, 'https://old.example.com');
      expect(storage.favorites.single.name, '原有收藏');
    },
  );

  test('importBackupJson rejects a payload that is not a JSON object', () async {
    final storage = InMemoryLibraryStorage();
    final repository = InMemoryDownloadLibraryRepository();
    final controller = LibraryController(
      storage: storage,
      downloadLibraryRepository: repository,
    );
    await controller.load();

    await expectLater(
      controller.importBackupJson('[1, 2, 3]'),
      throwsA(isA<FormatException>()),
    );
    // 解析失败时不能动到资料库。
    expect(controller.state.favorites, isEmpty);
  });
}
