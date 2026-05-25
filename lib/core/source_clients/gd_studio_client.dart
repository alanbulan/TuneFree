import '../models/music_source.dart';
import '../models/song.dart';
import '../network/music_url_normalizer.dart';
import '../network/source_data_parsing.dart';
import '../network/source_http_client.dart';

abstract class GdStudioClient {
  Future<List<Song>> search(String keyword, String source, int page);
}

const defaultGdStudioSearchApiBase = 'https://music-api.gdstudio.xyz/api.php';

final class ReactGdStudioClient implements GdStudioClient {
  ReactGdStudioClient({
    required SourceHttpClient httpClient,
    String apiBase = defaultGdStudioSearchApiBase,
  }) : _httpClient = httpClient,
       _apiBase = apiBase;

  static const _limit = 30;

  final SourceHttpClient _httpClient;
  final String _apiBase;

  @override
  Future<List<Song>> search(String keyword, String source, int page) async {
    final payload = await _httpClient.getJson(
      _buildUri(<String, String>{
        'types': 'search',
        'source': source,
        'name': keyword,
        'count': '$_limit',
        'pages': '$page',
      }),
    );
    final items = readMapList(payload);
    final songs = <Song>[];
    for (var index = 0; index < items.length; index += 1) {
      songs.add(_songFromTrack(items[index], source, page, index));
    }
    return songs.toList(growable: false);
  }

  Uri _buildUri(Map<String, String> queryParameters) {
    final baseUri = Uri.parse(_normalizeApiBase(_apiBase));
    return baseUri.replace(
      queryParameters: <String, String>{
        ...baseUri.queryParameters,
        ...queryParameters,
      },
    );
  }

  Song _songFromTrack(
    Map<String, dynamic> item,
    String source,
    int page,
    int index,
  ) {
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
      pic: _coverFromPicId(source, picId),
      picId: picId,
      lyricId: lyricId,
      urlId: urlId,
      source: MusicSourceWire.fromWire(source),
    );
  }

  String? _coverFromPicId(String source, String? picId) {
    if (picId == null) {
      return null;
    }
    if (picId.startsWith('http') || picId.startsWith('//')) {
      return normalizeMusicUrl(picId);
    }
    if (source == 'joox') {
      return normalizeMusicUrl(jooxCoverUrl(picId));
    }
    return null;
  }

  String _normalizeApiBase(String value) {
    final trimmed = value.trim();
    return trimmed.isEmpty ? defaultGdStudioSearchApiBase : trimmed;
  }
}
