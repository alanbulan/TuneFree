import '../../../core/models/music_source.dart';
import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';

final class LibraryBackupData {
  const LibraryBackupData({
    required this.favorites,
    required this.playlists,
    required this.apiKey,
    required this.corsProxy,
    required this.apiBase,
  });

  final List<Song> favorites;
  final List<Playlist> playlists;
  final String apiKey;
  final String corsProxy;
  final String apiBase;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'favorites': favorites.map((song) => song.toJson()).toList(growable: false),
      'playlists': playlists.map((playlist) => playlist.toJson()).toList(growable: false),
      'apiKey': apiKey,
      'corsProxy': corsProxy,
      'apiBase': apiBase,
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
          .map(
            (item) => Song.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList(growable: false),
      playlists: playlistsJson
          .map(
            (item) => Playlist.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList(growable: false),
      apiKey: json['apiKey'] as String? ?? '',
      corsProxy: json['corsProxy'] as String? ?? '',
      apiBase: json['apiBase'] as String? ?? '',
    );
  }
}

abstract class LibraryStorage {
  Future<List<Song>> loadFavorites();
  Future<void> saveFavorites(List<Song> values);
  Future<List<Playlist>> loadPlaylists();
  Future<void> savePlaylists(List<Playlist> values);
  Future<String> loadApiKey();
  Future<void> saveApiKey(String value);
  Future<String> loadCorsProxy();
  Future<void> saveCorsProxy(String value);
  Future<String> loadApiBase();
  Future<void> saveApiBase(String value);
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
    Song(
      id: 'fav-2',
      name: '晴天',
      artist: '周杰伦',
      source: MusicSource.qq,
    ),
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
  String _apiKey = '';
  String _corsProxy = '';
  String _apiBase = 'https://api.tune-free.example';

  @override
  Future<String> loadApiBase() async => _apiBase;

  @override
  Future<String> loadApiKey() async => _apiKey;

  @override
  Future<String> loadCorsProxy() async => _corsProxy;

  @override
  Future<List<Song>> loadFavorites() async => List<Song>.unmodifiable(_favorites);

  @override
  Future<List<Playlist>> loadPlaylists() async => List<Playlist>.unmodifiable(_playlists);

  @override
  Future<void> saveApiBase(String value) async {
    _apiBase = value;
  }

  @override
  Future<void> saveApiKey(String value) async {
    _apiKey = value;
  }

  @override
  Future<void> saveBackupData(LibraryBackupData value) async {
    _favorites = List<Song>.unmodifiable(value.favorites);
    _playlists = List<Playlist>.unmodifiable(value.playlists);
    _apiKey = value.apiKey;
    _corsProxy = value.corsProxy;
    _apiBase = value.apiBase;
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
      apiKey: _apiKey,
      corsProxy: _corsProxy,
      apiBase: _apiBase,
    );
  }
}
