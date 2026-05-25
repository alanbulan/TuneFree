import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/network/source_http_client.dart';
import 'package:tunefree/core/network/tune_free_http_client.dart';
import 'package:tunefree/core/source_clients/gd_studio_client.dart';
import 'package:tunefree/core/source_clients/kuwo_client.dart';
import 'package:tunefree/core/source_clients/netease_client.dart';
import 'package:tunefree/core/source_clients/qq_client.dart';

final class _RecordedSourceRequest {
  const _RecordedSourceRequest({
    required this.method,
    required this.requestUri,
    required this.targetUri,
    this.body,
  });

  final String method;
  final Uri requestUri;
  final Uri targetUri;
  final Object? body;
}

final class _FakeSourceAdapter implements HttpClientAdapter {
  final requests = <_RecordedSourceRequest>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final targetUri = _targetUri(options.uri);
    final body = await _readBody(requestStream);
    requests.add(
      _RecordedSourceRequest(
        method: options.method,
        requestUri: options.uri,
        targetUri: targetUri,
        body: body,
      ),
    );

    if (targetUri.host == 'music.163.com') {
      if (targetUri.path == '/api/cloudsearch/pc') {
        return _jsonResponse({
          'result': {
            'songs': [
              {
                'id': 123,
                'name': '网易歌曲',
                'ar': [
                  {'name': '歌手A'},
                  {'name': '歌手B'},
                ],
                'al': {
                  'name': '网易专辑',
                  'picUrl': 'http://p1.music.126.net/cover-300x300.jpg',
                },
              },
            ],
          },
        });
      }
      if (targetUri.path == '/api/toplist/detail') {
        return _jsonResponse({
          'list': [
            {
              'id': 19723756,
              'name': '云音乐飙升榜',
              'updateFrequency': '每日更新',
              'coverImgUrl': 'http://p2.music.126.net/top-300x300.jpg',
            },
          ],
        });
      }
      return _jsonResponse({
        'playlist': {
          'tracks': [
            {
              'id': 456,
              'name': '榜单歌曲',
              'ar': [
                {'name': '榜单歌手'},
              ],
              'al': {'name': '榜单专辑'},
            },
          ],
        },
      });
    }

    if (targetUri.host == 'u.y.qq.com') {
      final requestBody = body! as Map<String, dynamic>;
      final req = requestBody['req']! as Map<String, dynamic>;
      if (req['method'] == 'GetAll') {
        return _jsonResponse({
          'req': {
            'code': 0,
            'data': {
              'group': [
                {
                  'toplist': [
                    {
                      'topId': 26,
                      'title': 'QQ热歌榜',
                      'period': '每日更新',
                      'frontPicUrl': 'http://y.gtimg.cn/top-300x300.jpg',
                    },
                  ],
                },
              ],
            },
          },
        });
      }
      if (req['method'] == 'GetDetail') {
        return _jsonResponse({
          'req': {
            'code': 0,
            'data': {
              'data': {
                'songInfoList': [_qqSong()],
              },
            },
          },
        });
      }
      return _jsonResponse({
        'req': {
          'code': 0,
          'data': {
            'body': {
              'song': {
                'list': [_qqSong()],
              },
            },
          },
        },
      });
    }

    if (targetUri.host == 'search.kuwo.cn') {
      return _textResponse(
        "{'abslist':[{'MUSICRID':'MUSIC_789','SONGNAME':'酷我&nbsp;歌曲','ARTIST':'酷我&nbsp;歌手','ALBUM':'酷我专辑'}]}",
      );
    }

    if (targetUri.host == 'artistpicserver.kuwo.cn') {
      return _textResponse('http://img1.kuwo.cn/star/cover.jpg');
    }

    if (targetUri.host == 'kbangserver.kuwo.cn') {
      if (targetUri.queryParameters['rn'] == '1') {
        return _jsonResponse({'v9_pic2': 'http://img1.kuwo.cn/chart.jpg'});
      }
      return _jsonResponse({
        'musiclist': [
          {
            'id': 321,
            'name': '酷我榜单歌',
            'artist': '榜单歌手',
            'album': '榜单专辑',
            'param': '酷我榜单歌;榜单歌手;榜单专辑;0;0;MUSIC_654;0;0;MP3_654;0;0;MV_1;1',
          },
        ],
      });
    }

    if (targetUri.host == 'music-api.gdstudio.xyz') {
      return _jsonResponse([
        {
          'id': 'joox-id',
          'name': 'JOOX歌曲',
          'artist': ['JOOX歌手A', 'JOOX歌手B'],
          'album': 'JOOX专辑',
          'pic_id': 'joox-pic',
          'url_id': 'joox-url',
          'lyric_id': 'joox-lyric',
        },
      ]);
    }

    return _jsonResponse(<String, dynamic>{}, statusCode: 404);
  }

  @override
  void close({bool force = false}) {}

  static Map<String, dynamic> _qqSong() {
    return {
      'mid': 'qq-song-mid',
      'name': 'QQ歌曲',
      'singer': [
        {'name': 'QQ歌手'},
      ],
      'album': {'mid': 'qq-album-mid', 'name': 'QQ专辑'},
    };
  }

  static Uri _targetUri(Uri requestUri) {
    if (requestUri.host == 'proxy.test') {
      return Uri.parse(requestUri.queryParameters['url']!);
    }
    return requestUri;
  }

  static Future<Object?> _readBody(Stream<Uint8List>? requestStream) async {
    if (requestStream == null) {
      return null;
    }
    final bytes = <int>[];
    await for (final chunk in requestStream) {
      bytes.addAll(chunk);
    }
    if (bytes.isEmpty) {
      return null;
    }
    return jsonDecode(utf8.decode(bytes));
  }

  static ResponseBody _jsonResponse(Object body, {int statusCode = 200}) {
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }

  static ResponseBody _textResponse(String body, {int statusCode = 200}) {
    return ResponseBody.fromString(
      body,
      statusCode,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['text/plain'],
      },
    );
  }
}

SourceHttpClient _sourceHttpClient(_FakeSourceAdapter adapter) {
  final dio = Dio()..httpClientAdapter = adapter;
  return SourceHttpClient(
    httpClient: TuneFreeHttpClient(dio: dio),
    corsProxyProvider: () => 'https://proxy.test/?url={url}',
  );
}

void main() {
  test('NetEase client requests React endpoints and maps tracks', () async {
    final adapter = _FakeSourceAdapter();
    final client = ReactNeteaseClient(httpClient: _sourceHttpClient(adapter));

    final songs = await client.search('gbc', 2);
    final lists = await client.getTopLists();
    final detail = await client.getTopListDetail('19723756');

    expect(adapter.requests.first.targetUri.path, '/api/cloudsearch/pc');
    expect(adapter.requests.first.targetUri.queryParameters['s'], 'gbc');
    expect(adapter.requests.first.targetUri.queryParameters['offset'], '30');
    expect(songs.single.id, '123');
    expect(songs.single.artist, '歌手A, 歌手B');
    expect(songs.single.pic, 'https://p1.music.126.net/cover-500x500.jpg');
    expect(
      lists.single.coverImgUrl,
      'https://p2.music.126.net/top-500x500.jpg',
    );
    expect(detail.single.name, '榜单歌曲');
  });

  test('QQ client posts musicu requests and maps songs/toplists', () async {
    final adapter = _FakeSourceAdapter();
    final client = ReactQqClient(httpClient: _sourceHttpClient(adapter));

    final songs = await client.search('句号', 1);
    final lists = await client.getTopLists();
    final detail = await client.getTopListDetail('26');

    final searchBody = adapter.requests.first.body! as Map<String, dynamic>;
    final searchReq = searchBody['req']! as Map<String, dynamic>;
    expect(adapter.requests.first.method, 'POST');
    expect(searchReq['method'], 'DoSearchForQQMusicDesktop');
    expect(searchReq['module'], 'music.search.SearchCgiService');
    expect(songs.single.id, 'qq-song-mid');
    expect(songs.single.pic, contains('T002R500x500M000qq-album-mid.jpg'));
    expect(lists.single.id, '26');
    expect(lists.single.coverImgUrl, 'https://y.gtimg.cn/top-500x500.jpg');
    expect(detail.single.album, 'QQ专辑');
  });

  test('Kuwo client uses proxy-first HTTP APIs and fills covers', () async {
    final adapter = _FakeSourceAdapter();
    final client = ReactKuwoClient(
      httpClient: _sourceHttpClient(adapter),
      corsProxyProvider: () => 'https://proxy.test/?url={url}',
    );

    final songs = await client.search('酷我', 1);
    final lists = await client.getTopLists();
    final detail = await client.getTopListDetail('93');

    expect(adapter.requests.first.requestUri.host, 'proxy.test');
    expect(adapter.requests.first.targetUri.host, 'search.kuwo.cn');
    expect(songs.single.id, '789');
    expect(songs.single.name, '酷我 歌曲');
    expect(songs.single.artist, '酷我 歌手');
    expect(songs.single.pic, 'http://img1.kuwo.cn/star/cover.jpg');
    expect(lists, hasLength(7));
    expect(lists.first.name, '酷我飙升榜');
    expect(lists.first.coverImgUrl, 'http://img1.kuwo.cn/chart.jpg');
    expect(detail.single.id, '321');
    expect(detail.single.urlId, '654');
    expect(detail.single.lyricId, '654');
    expect(detail.single.name, '酷我榜单歌');
    expect(detail.single.pic, 'http://img1.kuwo.cn/star/cover.jpg');
  });

  test(
    'GD Studio client maps JOOX search metadata for playback resolution',
    () async {
      final adapter = _FakeSourceAdapter();
      final client = ReactGdStudioClient(
        httpClient: _sourceHttpClient(adapter),
      );

      final songs = await client.search('joox', 'joox', 3);

      expect(
        adapter.requests.single.targetUri.queryParameters,
        <String, String>{
          'types': 'search',
          'source': 'joox',
          'name': 'joox',
          'count': '30',
          'pages': '3',
        },
      );
      expect(songs.single.id, 'joox-id');
      expect(songs.single.artist, 'JOOX歌手A, JOOX歌手B');
      expect(songs.single.picId, 'joox-pic');
      expect(songs.single.urlId, 'joox-url');
      expect(songs.single.lyricId, 'joox-lyric');
      expect(
        songs.single.pic,
        'https://image.joox.com/JOOXcover/0/joox-pic/500',
      );
    },
  );
}
