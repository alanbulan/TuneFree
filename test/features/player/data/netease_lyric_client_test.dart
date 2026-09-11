import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/data/netease_lyric_client.dart';

final class _StubAdapter implements HttpClientAdapter {
  _StubAdapter(this.body, {this.statusCode = 200});

  final String body;
  final int statusCode;

  final List<RequestOptions> requests = <RequestOptions>[];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    return ResponseBody.fromString(
      body,
      statusCode,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

NeteaseLyricClient _client(Object payload, {int statusCode = 200}) {
  final dio = Dio();
  final adapter = _StubAdapter(jsonEncode(payload), statusCode: statusCode);
  dio.httpClientAdapter = adapter;
  return NeteaseLyricClient(dio: dio);
}

void main() {
  test('从 romalrc 取出罗马音轨', () async {
    final client = _client(<String, dynamic>{
      'romalrc': <String, dynamic>{
        'lyric': '[00:01.43]shi zu mu yo u\n[00:08.83]fu ta ri',
      },
      'lrc': <String, dynamic>{'lyric': 'ignored'},
    });

    final tracks = await client.loadTracks('1409311773');

    expect(tracks?.romanization, contains('shi zu mu yo u'));
    expect(tracks?.hasKaraoke, isFalse);
  });

  test('从 yrc / ytlrc / yromalrc 取出整套 v1 轨道', () async {
    final client = _client(<String, dynamic>{
      'yrc': <String, dynamic>{'lyric': '[830,4980](830,380,0)夢(1210,330,0)な'},
      'ytlrc': <String, dynamic>{'lyric': '[00:00.830]如果这一切都是梦境'},
      'yromalrc': <String, dynamic>{'lyric': '[00:00.830]yu me na ra ba'},
      'romalrc': <String, dynamic>{'lyric': '[00:00.850]yu me na ra ba'},
    });

    final tracks = await client.loadTracks('1466598056');

    expect(tracks?.hasKaraoke, isTrue);
    expect(tracks?.karaoke, contains('[830,4980]'));
    expect(tracks?.karaokeTranslation, contains('如果这一切都是梦境'));
    expect(tracks?.karaokeRomanization, contains('yu me na ra ba'));
    // legacy 那条罗马音和 v1 那条是两套时间轴（850 vs 830），必须分开带回来。
    expect(tracks?.romanization, contains('[00:00.850]'));
  });

  test('没有 yrc 时 hasKaraoke 为 false，罗马音照样能取到', () async {
    final client = _client(<String, dynamic>{
      'romalrc': <String, dynamic>{'lyric': '[00:01.43]shi zu mu yo u'},
    });

    final tracks = await client.loadTracks('536622304');

    expect(tracks?.hasKaraoke, isFalse);
    expect(tracks?.karaoke, isNull);
    expect(tracks?.romanization, isNotNull);
  });

  test('轨道为空串时视为缺失，返回 null 而不是空串', () async {
    // 三条轨都只有空白 —— 等于什么都没拿到，整个响应判空。
    final empty = _client(<String, dynamic>{
      'romalrc': <String, dynamic>{'lyric': ''},
      'yrc': <String, dynamic>{'lyric': '   '},
    });
    expect(await empty.loadTracks('186016'), isNull);

    // 有内容的轨道照常返回，空的那条是 null。
    final mixed = _client(<String, dynamic>{
      'yrc': <String, dynamic>{'lyric': '[830,4980](830,380,0)夢'},
      'ytlrc': <String, dynamic>{'lyric': ''},
      'romalrc': <String, dynamic>{'lyric': '   '},
    });
    final tracks = await mixed.loadTracks('186016');
    expect(tracks?.karaoke, contains('夢'));
    expect(tracks?.karaokeTranslation, isNull);
    expect(tracks?.romanization, isNull);
    expect(tracks?.hasKaraoke, isTrue);
  });

  test('整个响应里一条扩展轨都没有时返回 null', () async {
    final client = _client(<String, dynamic>{'code': 200});

    expect(await client.loadTracks('186016'), isNull);
  });

  test('不是数字的 id 直接跳过，不发请求', () async {
    final dio = Dio();
    final adapter = _StubAdapter('{}');
    dio.httpClientAdapter = adapter;
    final client = NeteaseLyricClient(dio: dio);

    // 别的音源的 id 是 GD Studio 自己的 id 空间（例如 joox 的 base64），
    // 拿去查网易只会得到错误响应，白白多一次往返。
    expect(await client.loadTracks('xjLXtSOROwud0Vj3aC66dQ=='), isNull);
    expect(await client.loadTracks(''), isNull);
    expect(adapter.requests, isEmpty);
  });

  test('请求带上了浏览器 UA 与 Referer，以及 v1 那一组参数', () async {
    final dio = Dio();
    final adapter = _StubAdapter(jsonEncode(<String, dynamic>{}));
    dio.httpClientAdapter = adapter;
    final client = NeteaseLyricClient(dio: dio);

    await client.loadTracks('186016');

    // 实测不带这两个头，响应会少掉 romalrc / klyric / tlyric。
    final request = adapter.requests.single;
    expect(request.headers['Referer'], 'https://music.163.com');
    expect(request.headers['User-Agent'], contains('Mozilla'));
    // 参数挂在 uri 上（getUri 传的就是完整 Uri），不是 queryParameters。
    final params = request.uri.queryParameters;
    expect(params['id'], '186016');
    expect(params['rv'], '1');
    // yv 必须是 -1：实测 `1` 只给 legacy 那套，`-1` 才会带出 yrc。
    expect(params['yv'], '-1');
    expect(params['ytv'], '-1');
    // 不请求 legacy 的 lrc / tlyric —— 主轨和译文已经从 GD Studio 拿了。
    expect(params.containsKey('lv'), isFalse);
    expect(params.containsKey('tv'), isFalse);
  });

  test('请求失败时静默返回 null，不影响歌词本身', () async {
    final client = _client(<String, dynamic>{
      'detail': 'boom',
    }, statusCode: 500);

    expect(await client.loadTracks('186016'), isNull);
  });
}
