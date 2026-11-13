import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:tunefree/core/network/tune_free_http_client.dart';
import 'package:tunefree/core/update/app_update_service.dart';

Map<String, dynamic> _release(
  String tag, {
  bool apk = true,
  bool draft = false,
  bool prerelease = false,
}) => {
  'tag_name': tag,
  'name': 'TuneFree $tag',
  'html_url': 'https://github.com/alanbulan/TuneFree/releases/tag/$tag',
  'draft': draft,
  'prerelease': prerelease,
  'assets': [
    {
      'name': apk ? 'tunefree.apk' : 'latest.json',
      'browser_download_url':
          'https://github.com/alanbulan/TuneFree/releases/download/$tag/'
          '${apk ? 'tunefree.apk' : 'latest.json'}',
    },
  ],
};

void main() {
  group('AppUpdateService', () {
    test('parses latest GitHub release with APK asset', () {
      final release = AppUpdateService.parseLatestRelease({
        'tag_name': 'v1.2.3',
        'name': 'TuneFree 1.2.3',
        'html_url':
            'https://github.com/alanbulan/TuneFree_Mobile/releases/tag/v1.2.3',
        'assets': [
          {
            'name': 'tunefree-v1.2.3.apk',
            'browser_download_url': 'https://github.com/alanbulan/TuneFree_Mobile/releases/download/v1.2.3/tunefree.apk',
          },
        ],
      });

      expect(release.version, '1.2.3');
      expect(release.name, 'TuneFree 1.2.3');
      expect(release.releaseUri.host, 'github.com');
      expect(release.downloadUri.path, contains('tunefree.apk'));
    });

    test('falls back to release page when APK asset is missing', () {
      final release = AppUpdateService.parseLatestRelease({
        'tag_name': 'v1.2.3',
        'html_url':
            'https://github.com/alanbulan/TuneFree_Mobile/releases/tag/v1.2.3',
        'assets': [
          {
            'name': 'source.zip',
            'browser_download_url': 'https://example.com/source.zip',
          },
        ],
      });

      expect(release.downloadUri, release.releaseUri);
    });

    test('rejects invalid release payload', () {
      expect(
        () => AppUpdateService.parseLatestRelease({'tag_name': ''}),
        throwsA(isA<AppUpdateException>()),
      );
    });

    test('compares semantic versions', () {
      expect(AppUpdateService.isVersionNewer('v1.0.1', '1.0.0'), isTrue);
      expect(AppUpdateService.isVersionNewer('1.0.10', '1.0.2'), isTrue);
      expect(AppUpdateService.isVersionNewer('1.0.0', '1.0.0'), isFalse);
      expect(AppUpdateService.isVersionNewer('1.0.0', '1.0.1'), isFalse);
      expect(AppUpdateService.isVersionNewer('mobile-v1.0.8', '1.0.7'), isTrue);
    });

    test(
      'selects the highest stable APK version across mobile and old tags',
      () {
        final release = AppUpdateService.parseLatestAndroidRelease([
          _release('v1.1.43', apk: false),
          _release('mobile-v1.0.9', prerelease: true),
          _release('mobile-v1.0.10', draft: true),
          _release('mobile-v1.0.8'),
          _release('v1.0.7'),
          _release('v1.0.6'),
          _release('mobile-v1.0.11-beta'),
          _release('invalid'),
        ]);

        expect(release.version, '1.0.8');
        expect(release.downloadUri.path, contains('/mobile-v1.0.8/'));
      },
    );

    test('still finds legacy Android releases before the first mobile tag', () {
      final release = AppUpdateService.parseLatestAndroidRelease([
        _release('v1.1.43', apk: false),
        _release('v1.0.6'),
        _release('v1.0.7'),
      ]);
      expect(release.version, '1.0.7');
    });

    test('ignores malformed releases and fails when no stable APK exists', () {
      expect(
        () => AppUpdateService.parseLatestAndroidRelease([
          _release('v1.1.43', apk: false),
          {..._release('mobile-v1.0.8'), 'html_url': ''},
          {
            ..._release('mobile-v1.0.9'),
            'assets': [
              {'name': 'tunefree.apk', 'browser_download_url': 'invalid'},
            ],
          },
          _release('mobile-v1.0.10', prerelease: true),
        ]),
        throwsA(isA<AppUpdateException>()),
      );
    });

    test('checks every releases page and reports the Android update', () async {
      final requests = <Uri>[];
      final dio = Dio();
      dio.interceptors.add(
        InterceptorsWrapper(
          onRequest: (options, handler) {
            requests.add(options.uri);
            final firstPage = options.uri.queryParameters['page'] == '1';
            final items = firstPage
                ? List.generate(
                    100,
                    (index) => _release('v9.0.$index', apk: false),
                  )
                : [_release('mobile-v1.0.8'), _release('v1.0.7')];
            handler.resolve(
              Response(requestOptions: options, data: jsonEncode(items)),
            );
          },
        ),
      );
      final service = AppUpdateService(
        httpClient: TuneFreeHttpClient(dio: dio),
        packageInfoLoader: () async => PackageInfo(
          appName: 'TuneFree',
          packageName: 'com.alanbulan.tunefree',
          version: '1.0.7',
          buildNumber: '8',
        ),
      );

      final update = await service.checkForUpdate();
      expect(requests, hasLength(2));
      expect(requests.first.path, '/repos/alanbulan/TuneFree/releases');
      expect(requests.last.queryParameters['page'], '2');
      expect(update.hasUpdate, isTrue);
      expect(update.currentVersion, '1.0.7');
      expect(update.latestVersion, '1.0.8');
      expect(update.downloadUri.path, endsWith('.apk'));
      dio.close();
    });
  });
}
