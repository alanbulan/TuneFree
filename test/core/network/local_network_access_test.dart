import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/network/local_network_access.dart';
import 'package:tunefree/core/network/music_api_connection_tester.dart';
import 'package:tunefree/core/network/music_api_settings.dart';
import 'package:tunefree/core/network/source_http_client.dart';
import 'package:tunefree/core/network/tune_free_http_client.dart';

void main() {
  final binding = TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('tunefree/local_network');
  final messenger = binding.defaultBinaryMessenger;
  tearDown(() => messenger.setMockMethodCallHandler(channel, null));

  test('non-Android connections do not request a native permission', () async {
    var calls = 0;
    messenger.setMockMethodCallHandler(channel, (_) async {
      calls += 1;
      return true;
    });
    final access = LocalNetworkAccess(isAndroid: () => false);
    await access.ensureAccess(Uri.parse('http://192.168.1.10/api.php'));
    expect(calls, 0);
  });

  test('concurrent requests share permission checks and later requests recheck revocation', () async {
    var calls = 0;
    final response = Completer<bool>();
    messenger.setMockMethodCallHandler(channel, (call) {
      calls += 1;
      expect(call.method, 'ensureAccess');
      expect(call.arguments, {'host': '192.168.1.10'});
      return response.future;
    });
    final access = LocalNetworkAccess(isAndroid: () => true);
    final first = access.ensureAccess(Uri.parse('http://192.168.1.10/api.php'));
    final second = access.ensureAccess(
      Uri.parse('http://192.168.1.10/cover.png'),
    );
    await Future<void>.delayed(Duration.zero);
    expect(calls, 1);
    response.complete(true);
    await Future.wait([first, second]);

    messenger.setMockMethodCallHandler(channel, (_) async {
      calls += 1;
      return false;
    });
    await expectLater(
      access.ensureAccess(Uri.parse('http://192.168.1.10/api.php')),
      throwsA(isA<LocalNetworkPermissionDenied>()),
    );
    expect(calls, 2);
  });

  test(
    'permission denial blocks HTTP and connection checks explain how to retry',
    () async {
      messenger.setMockMethodCallHandler(channel, (_) async => false);
      final dio = Dio();
      var dispatched = false;
      final client = TuneFreeHttpClient(
        dio: dio,
        localNetworkAccess: LocalNetworkAccess(isAndroid: () => true),
      );
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            dispatched = true;
            handler.resolve(Response(requestOptions: options, data: []));
          },
        ),
      );
      final tester = MusicApiConnectionTester(httpClient: client);
      const settings = MusicApiSettings(
        musicApiBase: 'http://192.168.1.10/api.php',
        playlistApiBase: 'http://192.168.1.10/api',
        requestMode: MusicApiRequestMode.compatibleGet,
      );
      expect(await tester.testMusic(settings), contains('本地网络权限'));
      expect(await tester.testPlaylist(settings), contains('本地网络权限'));
      expect(dispatched, isFalse);
      dio.close(force: true);
    },
  );

  test(
    'waiting for system permission does not consume the HTTP timeout',
    () async {
      var calls = 0;
      messenger.setMockMethodCallHandler(channel, (_) async {
        if (calls++ == 0) {
          await Future<void>.delayed(const Duration(milliseconds: 30));
        }
        return true;
      });
      final dio = Dio();
      final httpClient = TuneFreeHttpClient(
        dio: dio,
        localNetworkAccess: LocalNetworkAccess(isAndroid: () => true),
      );
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) => handler.resolve(
            Response(requestOptions: options, data: '[{"id":"1"}]'),
          ),
        ),
      );
      final sourceClient = SourceHttpClient(
        httpClient: httpClient,
        timeout: const Duration(milliseconds: 10),
      );
      expect(
        await sourceClient.getJson(
          Uri.parse('http://192.168.1.10/api.php'),
          includeProxyFallback: false,
        ),
        [
          {'id': '1'},
        ],
      );
      dio.close(force: true);
    },
  );
}
