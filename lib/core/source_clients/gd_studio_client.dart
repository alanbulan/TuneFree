import '../models/music_source.dart';
import '../models/song.dart';
import '../network/gd_studio_api_client.dart';
import '../network/music_api_settings.dart';
import '../network/music_url_normalizer.dart';
import '../network/source_data_parsing.dart';
import '../network/source_http_client.dart';

abstract class GdStudioClient {
  Future<List<Song>> search(String keyword, String source, int page);
}

const defaultGdStudioSearchApiBase = defaultMusicApiBase;

final class ReactGdStudioClient implements GdStudioClient {
  ReactGdStudioClient({
    required SourceHttpClient httpClient,
    String apiBase = defaultGdStudioSearchApiBase,
    GdStudioApiClient? apiClient,
  }) : _apiClient =
           apiClient ??
           GdStudioApiClient(
             httpClient: httpClient,
             settingsLoader: () async => MusicApiSettings(
               musicApiBase: normalizeMusicApiUrl(apiBase, defaultMusicApiBase),
             ),
           );

  static const _limit = 30;

  final GdStudioApiClient _apiClient;

  @override
  Future<List<Song>> search(String keyword, String source, int page) async {
    final settings = await _apiClient.loadSettings();
    final payload = await _apiClient.request(<String, String>{
      'types': 'search',
      'source': source,
      'name': keyword,
      'count': '$_limit',
      'pages': '$page',
    }, settings: settings);
    if (payload is! List) {
      throw StateError('Music API returned an invalid search response');
    }
    final items = readMapList(payload);
    final songs = <Song>[];
    for (var index = 0; index < items.length; index += 1) {
      songs.add(
        _songFromTrack(
          items[index],
          source,
          page,
          index,
          useNativeCover: !settings.usesCustomMusicApi,
        ),
      );
    }
    return songs.toList(growable: false);
  }

  Song _songFromTrack(
    Map<String, dynamic> item,
    String source,
    int page,
    int index, {
    required bool useNativeCover,
  }) {
    final id =
        readString(item['id']) ??
        readString(item['url_id']) ??
        readString(item['lyric_id']) ??
        'temp_${source}_${page}_$index';
    final picId = readString(item['pic_id']);
    final lyricId = readString(item['lyric_id']) ?? id;
    final urlId = readString(item['url_id']) ?? id;

    return Song(
      id: id,
      name: readString(item['name']) ?? '',
      artist: joinNamedEntries(item['artist']),
      album: readString(item['album']) ?? '',
      pic: _coverFromPicId(source, picId, useNativeCover: useNativeCover),
      picId: picId,
      lyricId: lyricId,
      urlId: urlId,
      source: MusicSourceWire.fromWire(source),
    );
  }

  String? _coverFromPicId(
    String source,
    String? picId, {
    required bool useNativeCover,
  }) {
    if (picId == null) {
      return null;
    }
    if (picId.startsWith('http') || picId.startsWith('//')) {
      return normalizeMusicUrl(picId);
    }
    if (source == 'joox' && useNativeCover) {
      return normalizeMusicUrl(jooxCoverUrl(picId));
    }
    return null;
  }
}
