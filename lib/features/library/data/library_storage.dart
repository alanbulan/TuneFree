import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/models/music_source.dart';
import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';

final class LibraryBackupData {
  const LibraryBackupData({
    required this.favorites,
    required this.playlists,
    required this.corsProxy,
  });

  final List<Song> favorites;
  final List<Playlist> playlists;
  final String corsProxy;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'favorites': favorites
          .map((song) => song.toJson())
          .toList(growable: false),
      'playlists': playlists
          .map((playlist) => playlist.toJson())
          .toList(growable: false),
      'corsProxy': corsProxy,
    };
  }

  factory LibraryBackupData.fromJson(Map<String, dynamic> json) {
    final favoritesJson = json['favorites'];
    final playlistsJson = json['playlists'];
    if (favoritesJson is! List<dynamic>) {
      throw const FormatException('favorites must be a list');
    }
    if (playlistsJson is! List<dynamic>) {
      throw const FormatException('playlists must be a list');
    }

    return LibraryBackupData(
      favorites: favoritesJson
          .map((item) => Song.fromJson(Map<String, dynamic>.from(item as Map)))
          .toList(growable: false),
      playlists: playlistsJson
          .map(
            (item) => Playlist.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList(growable: false),
      corsProxy: json['corsProxy'] as String? ?? '',
    );
  }
}

abstract class LibraryStorage {
  Future<List<Song>> loadFavorites();
  Future<void> saveFavorites(List<Song> values);
  Future<List<Playlist>> loadPlaylists();
  Future<void> savePlaylists(List<Playlist> values);
  Future<String> loadCorsProxy();
  Future<void> saveCorsProxy(String value);
  Future<LibraryBackupData> loadBackupData();
  Future<void> saveBackupData(LibraryBackupData value);
}

final class LegacyLibraryStorage implements LibraryStorage {
  LegacyLibraryStorage()
    : _favorites = List<Song>.unmodifiable(_defaultFavorites),
      _playlists = List<Playlist>.unmodifiable(_defaultPlaylists);

  static const _defaultFavorites = <Song>[
    Song(
      id: 'fav-1',
      name: '海与你',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    ),
    Song(id: 'fav-2', name: '晴天', artist: '周杰伦', source: MusicSource.qq),
  ];

  static const _defaultPlaylists = <Playlist>[
    Playlist(
      id: 'playlist-1',
      name: '收藏歌单',
      createTime: 1713200000000,
      songs: _defaultFavorites,
    ),
  ];

  List<Song> _favorites;
  List<Playlist> _playlists;
  String _corsProxy = '';

  @override
  Future<String> loadCorsProxy() async => _corsProxy;

  @override
  Future<List<Song>> loadFavorites() async =>
      List<Song>.unmodifiable(_favorites);

  @override
  Future<List<Playlist>> loadPlaylists() async =>
      List<Playlist>.unmodifiable(_playlists);

  @override
  Future<void> saveBackupData(LibraryBackupData value) async {
    _favorites = List<Song>.unmodifiable(value.favorites);
    _playlists = List<Playlist>.unmodifiable(value.playlists);
    _corsProxy = value.corsProxy;
  }

  @override
  Future<void> saveCorsProxy(String value) async {
    _corsProxy = value;
  }

  @override
  Future<void> saveFavorites(List<Song> values) async {
    _favorites = List<Song>.unmodifiable(values);
  }

  @override
  Future<void> savePlaylists(List<Playlist> values) async {
    _playlists = List<Playlist>.unmodifiable(values);
  }

  @override
  Future<LibraryBackupData> loadBackupData() async {
    return LibraryBackupData(
      favorites: List<Song>.unmodifiable(_favorites),
      playlists: List<Playlist>.unmodifiable(_playlists),
      corsProxy: _corsProxy,
    );
  }
}

final class SharedPreferencesLibraryStorage implements LibraryStorage {
  SharedPreferencesLibraryStorage({
    Future<SharedPreferences> Function()? preferencesProvider,
  }) : _preferencesProvider =
           preferencesProvider ?? SharedPreferences.getInstance;

  static const _favoritesKey = 'tunefree_favorites';
  static const _playlistsKey = 'tunefree_playlists';
  static const _corsProxyKey = 'tunefree_cors_proxy';

  final Future<SharedPreferences> Function() _preferencesProvider;

  @override
  Future<String> loadCorsProxy() async {
    return (await _preferencesProvider()).getString(_corsProxyKey) ?? '';
  }

  @override
  Future<List<Song>> loadFavorites() async {
    final rawValue = (await _preferencesProvider()).getString(_favoritesKey);
    return _decodeList(rawValue, Song.fromJson);
  }

  @override
  Future<List<Playlist>> loadPlaylists() async {
    final rawValue = (await _preferencesProvider()).getString(_playlistsKey);
    return _decodeList(rawValue, Playlist.fromJson);
  }

  @override
  Future<void> saveCorsProxy(String value) async {
    await (await _preferencesProvider()).setString(_corsProxyKey, value);
  }

  @override
  Future<void> saveFavorites(List<Song> values) async {
    await _saveList(_favoritesKey, values.map((song) => song.toJson()));
  }

  @override
  Future<void> savePlaylists(List<Playlist> values) async {
    await _saveList(_playlistsKey, values.map((playlist) => playlist.toJson()));
  }

  @override
  Future<LibraryBackupData> loadBackupData() async {
    return LibraryBackupData(
      favorites: await loadFavorites(),
      playlists: await loadPlaylists(),
      corsProxy: await loadCorsProxy(),
    );
  }

  @override
  Future<void> saveBackupData(LibraryBackupData value) async {
    await saveFavorites(value.favorites);
    await savePlaylists(value.playlists);
    await saveCorsProxy(value.corsProxy);
  }

  Future<void> _saveList(
    String key,
    Iterable<Map<String, dynamic>> values,
  ) async {
    final encodedValue = jsonEncode(values.toList(growable: false));
    await (await _preferencesProvider()).setString(key, encodedValue);
  }

  List<T> _decodeList<T>(
    String? rawValue,
    T Function(Map<String, dynamic>) decode,
  ) {
    if (rawValue == null || rawValue.trim().isEmpty) {
      return List<T>.empty(growable: false);
    }

    try {
      final decodedValue = jsonDecode(rawValue);
      if (decodedValue is! List<dynamic>) {
        return List<T>.empty(growable: false);
      }

      final values = <T>[];
      for (final item in decodedValue) {
        if (item is! Map) {
          return List<T>.empty(growable: false);
        }
        values.add(decode(Map<String, dynamic>.from(item)));
      }
      return List<T>.unmodifiable(values);
    } catch (_) {
      return List<T>.empty(growable: false);
    }
  }
}
