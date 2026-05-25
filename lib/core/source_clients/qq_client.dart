import '../models/music_source.dart';
import '../models/song.dart';
import '../models/top_list.dart';
import '../network/music_url_normalizer.dart';
import '../network/source_data_parsing.dart';
import '../network/source_http_client.dart';

abstract class QqClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}

final class ReactQqClient implements QqClient {
  ReactQqClient({required SourceHttpClient httpClient})
    : _httpClient = httpClient;

  static const _limit = 30;
  static const _musicuUri = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
  static const _comm = <String, Object>{
    'ct': 11,
    'cv': 1003006,
    'v': 1003006,
    'os_ver': '12',
    'phonetype': 0,
    'buildnum': 166,
    'tmeLoginType': 2,
  };

  final SourceHttpClient _httpClient;

  @override
  Future<List<Song>> search(String keyword, int page) async {
    final data = await _musicuFetch(<String, Object>{
      'method': 'DoSearchForQQMusicDesktop',
      'module': 'music.search.SearchCgiService',
      'param': <String, Object>{
        'query': keyword,
        'page_num': page,
        'num_per_page': _limit,
      },
    });
    return readMapList(
      readPath(data, const <Object>['body', 'song', 'list']),
    ).map(_songFromItem).whereType<Song>().toList(growable: false);
  }

  @override
  Future<List<TopList>> getTopLists() async {
    final data = await _musicuFetch(const <String, Object>{
      'module': 'musicToplist.ToplistInfoServer',
      'method': 'GetAll',
      'param': <String, Object>{},
    });
    return _flattenTopListGroups(
      data,
    ).map(_topListFromItem).whereType<TopList>().toList(growable: false);
  }

  @override
  Future<List<Song>> getTopListDetail(String id) async {
    final data = await _musicuFetch(<String, Object>{
      'module': 'musicToplist.ToplistInfoServer',
      'method': 'GetDetail',
      'param': <String, Object>{
        'topId': int.tryParse(id) ?? id,
        'offset': 0,
        'num': 100,
      },
    });
    final list = readMapList(
      readPath(data, const <Object>['data', 'songInfoList']),
    );
    return (list.isEmpty ? readMapList(data['songInfoList']) : list)
        .map(_songFromItem)
        .whereType<Song>()
        .toList(growable: false);
  }

  Future<Map<String, dynamic>> _musicuFetch(Map<String, Object> reqBody) async {
    final payload = await _httpClient.postJson(
      Uri.parse(_musicuUri),
      data: <String, Object>{'comm': _comm, 'req': reqBody},
    );
    final request = readMap(readMap(payload)?['req']);
    if (request == null || request['code'] != 0) {
      throw StateError('QQ Music returned an error response.');
    }
    return readMap(request['data']) ?? const <String, dynamic>{};
  }

  List<Map<String, dynamic>> _flattenTopListGroups(Map<String, dynamic> data) {
    final groups = readList(data['group']).isNotEmpty
        ? readList(data['group'])
        : readList(data['groupList']);
    final items = <Map<String, dynamic>>[];
    for (final groupValue in groups) {
      final group = readMap(groupValue);
      if (group == null) {
        continue;
      }
      for (final key in const <String>['toplist', 'topList', 'list']) {
        items.addAll(readMapList(group[key]));
      }
    }
    if (items.isNotEmpty) {
      return items;
    }
    return readMapList(data['toplist']);
  }

  Song? _songFromItem(Map<String, dynamic> item) {
    final id =
        readString(item['mid']) ??
        readString(item['songmid']) ??
        readString(item['id']);
    final name = readString(item['name']) ?? readString(item['title']);
    if (id == null || name == null) {
      return null;
    }

    final album = readMap(item['album']);
    final albumMid = readString(album?['mid']);
    final cover = albumMid == null
        ? null
        : normalizeMusicUrl(
            'https://y.gtimg.cn/music/photo_new/T002R500x500M000$albumMid.jpg',
          );

    return Song(
      id: id,
      name: name,
      artist: joinNamedEntries(item['singer']),
      album: readString(album?['name']) ?? readString(album?['title']) ?? '',
      pic: cover,
      source: MusicSource.qq,
    );
  }

  TopList? _topListFromItem(Map<String, dynamic> item) {
    final id = readString(item['topId']) ?? readString(item['id']);
    final name = readString(item['title']) ?? readString(item['name']);
    if (id == null || name == null) {
      return null;
    }

    final cover = normalizeMusicUrl(
      readString(item['frontPicUrl']) ??
          readString(item['headPicUrl']) ??
          readString(item['musichallPicUrl']),
    );
    return TopList(
      id: id,
      name: name,
      updateFrequency: readString(item['period']),
      picUrl: cover,
      coverImgUrl: cover,
    );
  }
}
