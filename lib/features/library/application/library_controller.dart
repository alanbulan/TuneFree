import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';
import '../data/library_storage.dart';
import 'library_state.dart';

final libraryStorageProvider = Provider<LibraryStorage>((ref) {
  return LegacyLibraryStorage();
});

final libraryControllerProvider = ChangeNotifierProvider<LibraryController>((ref) {
  final controller = LibraryController(storage: ref.watch(libraryStorageProvider));
  controller.load();
  return controller;
});

final class LibraryController extends ChangeNotifier {
  LibraryController({required LibraryStorage storage}) : _storage = storage;

  final LibraryStorage _storage;

  LibraryState _state = const LibraryState();
  LibraryState get state => _state;

  Future<void> load() async {
    _state = _state.copyWith(
      favorites: await _storage.loadFavorites(),
      playlists: await _storage.loadPlaylists(),
      apiKey: await _storage.loadApiKey(),
      corsProxy: await _storage.loadCorsProxy(),
      apiBase: await _storage.loadApiBase(),
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
        ? _state.favorites.where((item) => item.key != song.key).toList(growable: false)
        : <Song>[song, ..._state.favorites];
    await _storage.saveFavorites(nextFavorites);
    _state = _state.copyWith(favorites: nextFavorites);
    notifyListeners();
  }

  Future<Playlist> createPlaylist(String name, {List<Song> initialSongs = const <Song>[]}) async {
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
        .map((playlist) => playlist.id == id ? playlist.copyWith(name: name) : playlist)
        .toList(growable: false);
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  Future<void> deletePlaylist(String id) async {
    final playlists =
        _state.playlists.where((playlist) => playlist.id != id).toList(growable: false);
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
            songs: playlist.songs.where((item) => item.key != song.key).toList(growable: false),
          );
        })
        .toList(growable: false);
    await _storage.savePlaylists(playlists);
    _state = _state.copyWith(playlists: playlists);
    notifyListeners();
  }

  Future<void> setApiKey(String value) async {
    await _storage.saveApiKey(value);
    _state = _state.copyWith(apiKey: value);
    notifyListeners();
  }

  Future<void> setCorsProxy(String value) async {
    await _storage.saveCorsProxy(value);
    _state = _state.copyWith(corsProxy: value);
    notifyListeners();
  }

  Future<void> setApiBase(String value) async {
    await _storage.saveApiBase(value);
    _state = _state.copyWith(apiBase: value);
    notifyListeners();
  }

  Future<String> exportBackupJson() async {
    final backup = await _storage.loadBackupData();
    final jsonText = const JsonEncoder.withIndent('  ').convert(backup.toJson());
    _state = _state.copyWith(exportedBackupJson: jsonText);
    notifyListeners();
    return jsonText;
  }

  Future<void> importBackupJson(String rawJson) async {
    final decoded = jsonDecode(rawJson);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('backup payload must be an object');
    }

    final backup = LibraryBackupData.fromJson(decoded);
    await _storage.saveBackupData(backup);
    _state = _state.copyWith(
      favorites: backup.favorites,
      playlists: backup.playlists,
      apiKey: backup.apiKey,
      corsProxy: backup.corsProxy,
      apiBase: backup.apiBase,
      exportedBackupJson: null,
      lastImportSummary: '已导入 ${backup.favorites.length} 首收藏和 ${backup.playlists.length} 个歌单',
    );
    notifyListeners();
  }
}
