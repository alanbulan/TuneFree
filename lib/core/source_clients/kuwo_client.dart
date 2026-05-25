import '../models/music_source.dart';
import '../models/song.dart';
import '../models/top_list.dart';
import '../network/music_url_normalizer.dart';
import '../network/source_data_parsing.dart';
import '../network/source_http_client.dart';

abstract class KuwoClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}

final class ReactKuwoClient implements KuwoClient {
  ReactKuwoClient({
    required SourceHttpClient httpClient,
    String Function()? corsProxyProvider,
  }) : _httpClient = httpClient,
       _corsProxyProvider = corsProxyProvider;

  static const _limit = 30;
  static const _popularCharts = <({String id, String name})>[
    (id: '93', name: '酷我飙升榜'),
    (id: '17', name: '酷我新歌榜'),
    (id: '16', name: '酷我热歌榜'),
    (id: '158', name: '抖音热歌榜'),
    (id: '284', name: 'Billboard榜'),
    (id: '264', name: '酷我民谣榜'),
    (id: '145', name: '会员畅听榜'),
  ];

  final SourceHttpClient _httpClient;
  final String Function()? _corsProxyProvider;

  @override
  Future<List<Song>> search(String keyword, int page) async {
    final payload = await _httpClient.getJson(
      Uri.http('search.kuwo.cn', '/r.s', <String, String>{
        'all': keyword,
        'ft': 'music',
        'itemset': 'web_2013',
        'pn': '${page - 1}',
        'rn': '$_limit',
        'encoding': 'utf8',
        'rformat': 'json',
        'moession': '1',
        'vkey': 'VKEY',
      }),
      proxyFirst: true,
      allowSingleQuoteJson: true,
    );
    final songs = readMapList(
      readMap(payload)?['abslist'],
    ).map(_songFromSearchItem).whereType<Song>().toList(growable: false);
    return _fillCovers(songs);
  }

  @override
  Future<List<TopList>> getTopLists() async {
    final lists = await Future.wait(
      _popularCharts.map((chart) async {
        final cover = await _loadChartCover(chart.id);
        return TopList(
          id: chart.id,
          name: chart.name,
          updateFrequency: '每日更新',
          picUrl: cover,
          coverImgUrl: cover,
        );
      }),
    );
    return lists.toList(growable: false);
  }

  @override
  Future<List<Song>> getTopListDetail(String id) async {
    final payload = await _httpClient.getJson(
      Uri.http('kbangserver.kuwo.cn', '/ksong.s', <String, String>{
        'from': 'pc',
        'fmt': 'json',
        'pn': '0',
        'rn': '30',
        'type': 'bang',
        'data': 'content',
        'id': id,
      }),
      proxyFirst: true,
    );
    final songs = readMapList(
      readMap(payload)?['musiclist'],
    ).map(_songFromChartItem).whereType<Song>().toList(growable: false);
    return _fillCovers(songs);
  }

  Future<String?> _loadChartCover(String id) async {
    try {
      final payload = await _httpClient.getJson(
        Uri.http('kbangserver.kuwo.cn', '/ksong.s', <String, String>{
          'from': 'pc',
          'fmt': 'json',
          'type': 'bang',
          'data': 'content',
          'id': id,
          'pn': '0',
          'rn': '1',
        }),
        proxyFirst: true,
      );
      return _normalizeKuwoUrl(
        readString(readMap(payload)?['v9_pic2']) ??
            readString(readMap(payload)?['pic']),
      );
    } catch (_) {
      return null;
    }
  }

  Future<List<Song>> _fillCovers(List<Song> songs) async {
    final filledSongs = await Future.wait(
      songs.map((song) async {
        if (song.pic != null || song.id.isEmpty) {
          return song;
        }
        final cover = await _loadSongCover(song.id);
        return cover == null ? song : song.copyWith(pic: cover);
      }),
    );
    return filledSongs.toList(growable: false);
  }

  Future<String?> _loadSongCover(String id) async {
    try {
      final text = await _httpClient.getText(
        Uri.http('artistpicserver.kuwo.cn', '/pic.web', <String, String>{
          'corp': 'kuwo',
          'type': 'rid_pic',
          'pictype': '500',
          'size': '500',
          'rid': id,
        }),
        proxyFirst: true,
      );
      return _normalizeKuwoUrl(text);
    } catch (_) {
      return null;
    }
  }

  Song? _songFromSearchItem(Map<String, dynamic> item) {
    final musicRid = readString(item['MUSICRID']);
    final id =
        _stripMusicRid(musicRid) ??
        readString(item['DC_TARGETID']) ??
        readString(item['rid']) ??
        readString(item['id']);
    final name = readString(item['SONGNAME']) ?? readString(item['NAME']);
    if (id == null || name == null) {
      return null;
    }

    return Song(
      id: id,
      name: name,
      artist: readString(item['ARTIST']) ?? '',
      album: readString(item['ALBUM']) ?? '',
      pic: _coverFromShortPath(
        readString(item['web_albumpic_short']) ??
            readString(item['web_artistpic_short']),
      ),
      source: MusicSource.kuwo,
    );
  }

  Song? _songFromChartItem(Map<String, dynamic> item) {
    final playableId =
        _songRidFromChartParam(readString(item['param'])) ??
        readString(item['rid']) ??
        readString(item['id']);
    final id = readString(item['id']) ?? playableId;
    final name = readString(item['name']);
    if (id == null || playableId == null || name == null) {
      return null;
    }

    return Song(
      id: id,
      name: name,
      artist: readString(item['artist']) ?? '',
      album: readString(item['album']) ?? '',
      pic: _coverFromShortPath(
        readString(item['web_albumpic_short']) ??
            readString(item['web_artistpic_short']),
      ),
      urlId: playableId,
      lyricId: playableId,
      source: MusicSource.kuwo,
    );
  }

  String? _coverFromShortPath(String? value) {
    final trimmedValue = value?.trim();
    if (trimmedValue == null || trimmedValue.isEmpty) {
      return null;
    }
    if (trimmedValue.startsWith('http') || trimmedValue.startsWith('//')) {
      return _normalizeKuwoUrl(trimmedValue);
    }
    final highResolutionPath = trimmedValue.replaceFirst(
      RegExp(r'^\d+/'),
      '500/',
    );
    return _normalizeKuwoUrl(
      'https://img4.kuwo.cn/star/albumcover/$highResolutionPath',
    );
  }

  String? _normalizeKuwoUrl(String? value) {
    return normalizeMusicUrl(
      value,
      proxyKuwoHttp: true,
      corsProxyProvider: _corsProxyProvider,
    );
  }

  String? _songRidFromChartParam(String? value) {
    if (value == null) {
      return null;
    }
    final match = RegExp(r'(?:^|;)(MUSIC_[^;]+)').firstMatch(value);
    return _stripMusicRid(match?.group(1));
  }

  String? _stripMusicRid(String? value) {
    if (value == null) {
      return null;
    }
    return value.replaceFirst(RegExp('^MUSIC_'), '');
  }
}
