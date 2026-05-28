import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/update/app_update_service.dart';

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
            'browser_download_url':
                'https://github.com/alanbulan/TuneFree_Mobile/releases/download/v1.2.3/tunefree.apk',
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
    });
  });
}
