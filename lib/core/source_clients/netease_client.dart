import '../models/music_source.dart';
import '../models/song.dart';
import '../models/top_list.dart';
import '../network/music_url_normalizer.dart';
import '../network/source_data_parsing.dart';
import '../network/source_http_client.dart';

abstract class NeteaseClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
  Future<({String name, List<Song> songs})?> getPlaylist(String id);
}

final class ReactNeteaseClient implements NeteaseClient {
  ReactNeteaseClient({required SourceHttpClient httpClient})
    : _httpClient = httpClient;

  static const _limit = 30;

  final SourceHttpClient _httpClient;

  @override
  Future<List<Song>> search(String keyword, int page) async {
    final payload = await _httpClient.getJson(
      Uri.https('music.163.com', '/api/cloudsearch/pc', <String, String>{
        's': keyword,
        'type': '1',
        'offset': '${(page - 1) * _limit}',
        'limit': '$_limit',
      }),
    );
    return readMapList(
      readPath(payload, const <Object>['result', 'songs']),
    ).map(_songFromTrack).whereType<Song>().toList(growable: false);
  }

  @override
  Future<List<TopList>> getTopLists() async {
    final payload = await _httpClient.getJson(
      Uri.https('music.163.com', '/api/toplist/detail'),
    );
    return readMapList(
      readMap(payload)?['list'],
    ).map(_topListFromItem).whereType<TopList>().toList(growable: false);
  }

  @override
  Future<List<Song>> getTopListDetail(String id) async {
    final payload = await _httpClient.getJson(
      Uri.https('music.163.com', '/api/v6/playlist/detail', <String, String>{
        'id': id,
        'n': '30',
      }),
    );
    return readMapList(
      readPath(payload, const <Object>['playlist', 'tracks']),
    ).map(_songFromTrack).whereType<Song>().toList(growable: false);
  }

  @override
  Future<({String name, List<Song> songs})?> getPlaylist(String id) async {
    final payload = await _httpClient.getJson(
      Uri.https('music.163.com', '/api/v6/playlist/detail', <String, String>{
        'id': id,
        'n': '1000',
      }),
    );
    final playlist = readMap(readMap(payload)?['playlist']);
    if (playlist == null) {
      return null;
    }

    final songs = readMapList(
      playlist['tracks'],
    ).map(_songFromTrack).whereType<Song>().toList();

    // Fetch remaining tracks via trackIds when API truncates the tracks array.
    final allTrackIds = readMapList(playlist['trackIds'])
        .map((e) => readString(e['id']))
        .whereType<String>()
        .toList(growable: false);
    if (allTrackIds.length > songs.length) {
      final existingIds = songs.map((s) => s.id).toSet();
      final missingIds = allTrackIds
          .where((tid) => !existingIds.contains(tid))
          .toList(growable: false);
      final extraSongs = await _fetchSongsByIds(missingIds);
      songs.addAll(extraSongs);
    }

    if (songs.isEmpty) {
      return null;
    }

    return (name: readString(playlist['name']) ?? id, songs: songs);
  }

  static const _batchSize = 100;

  Future<List<Song>> _fetchSongsByIds(List<String> ids) async {
    final result = <Song>[];
    for (var i = 0; i < ids.length; i += _batchSize) {
      final batch = ids.sublist(i, (i + _batchSize).clamp(0, ids.length));
      final idsParam = '[${batch.join(',')}]';
      try {
        final payload = await _httpClient.getJson(
          Uri.https('music.163.com', '/api/song/detail', {
            'ids': idsParam,
          }),
        );
        result.addAll(
          readMapList(readPath(payload, const ['songs']))
              .map(_songFromDetail)
              .whereType<Song>(),
        );
      } catch (_) {
        // Skip failed batches; partial results are still useful.
      }
    }
    return result;
  }

  Song? _songFromDetail(Map<String, dynamic> item) {
    final id = readString(item['id']);
    final name = readString(item['name']);
    if (id == null || name == null) {
      return null;
    }

    final album = readMap(item['album']);
    return Song(
      id: id,
      name: name,
      artist: joinNamedEntries(item['artists']),
      album: readString(album?['name']) ?? '',
      pic: normalizeMusicUrl(readString(album?['picUrl'])),
      source: MusicSource.netease,
    );
  }

  Song? _songFromTrack(Map<String, dynamic> item) {
    final id = readString(item['id']);
    final name = readString(item['name']);
    if (id == null || name == null) {
      return null;
    }

    final album = readMap(item['al']);
    return Song(
      id: id,
      name: name,
      artist: joinNamedEntries(item['ar']),
      album: readString(album?['name']) ?? '',
      pic: normalizeMusicUrl(readString(album?['picUrl'])),
      source: MusicSource.netease,
    );
  }

  TopList? _topListFromItem(Map<String, dynamic> item) {
    final id = readString(item['id']);
    final name = readString(item['name']);
    if (id == null || name == null) {
      return null;
    }

    final cover = normalizeMusicUrl(readString(item['coverImgUrl']));
    return TopList(
      id: id,
      name: name,
      updateFrequency: readString(item['updateFrequency']),
      picUrl: cover,
      coverImgUrl: cover,
    );
  }
}
