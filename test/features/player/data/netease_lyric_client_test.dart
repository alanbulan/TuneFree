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

    final romanization = await client.loadRomanization('1409311773');

    expect(romanization, contains('shi zu mu yo u'));
  });

  test('罗马音为空时返回 null，而不是空串', () async {
    final client = _client(<String, dynamic>{
      'romalrc': <String, dynamic>{'lyric': ''},
    });

    expect(await client.loadRomanization('186016'), isNull);
  });

  test('响应里没有 romalrc 时返回 null', () async {
    final client = _client(<String, dynamic>{'code': 200});

    expect(await client.loadRomanization('186016'), isNull);
  });

  test('不是数字的 id 直接跳过，不发请求', () async {
    final dio = Dio();
    final adapter = _StubAdapter('{}');
    dio.httpClientAdapter = adapter;
    final client = NeteaseLyricClient(dio: dio);

    // 别的音源的 id 是 GD Studio 自己的 id 空间（例如 joox 的 base64），
    // 拿去查网易只会得到错误响应，白白多一次往返。
    expect(await client.loadRomanization('xjLXtSOROwud0Vj3aC66dQ=='), isNull);
    expect(await client.loadRomanization(''), isNull);
    expect(adapter.requests, isEmpty);
  });

  test('请求带上了浏览器 UA 与 Referer', () async {
    final dio = Dio();
    final adapter = _StubAdapter(jsonEncode(<String, dynamic>{}));
    dio.httpClientAdapter = adapter;
    final client = NeteaseLyricClient(dio: dio);

    await client.loadRomanization('186016');

    // 实测不带这两个头，响应会少掉 romalrc。
    final request = adapter.requests.single;
    expect(request.headers['Referer'], 'https://music.163.com');
    expect(request.headers['User-Agent'], contains('Mozilla'));
    // 参数挂在 uri 上（getUri 传的就是完整 Uri），不是 queryParameters。
    expect(request.uri.queryParameters['rv'], '1');
    expect(request.uri.queryParameters['id'], '186016');
  });

  test('请求失败时静默返回 null，不影响歌词本身', () async {
    final client = _client(<String, dynamic>{'detail': 'boom'}, statusCode: 500);

    expect(await client.loadRomanization('186016'), isNull);
  });
}
