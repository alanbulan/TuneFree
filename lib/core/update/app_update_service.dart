import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../network/tune_free_http_client.dart';

typedef PackageInfoLoader = Future<PackageInfo> Function();

final class AppUpdateInfo {
  const AppUpdateInfo({
    required this.currentVersion,
    required this.latestVersion,
    required this.releaseName,
    required this.releaseUri,
    required this.downloadUri,
    required this.hasUpdate,
  });

  final String currentVersion;
  final String latestVersion;
  final String releaseName;
  final Uri releaseUri;
  final Uri downloadUri;
  final bool hasUpdate;
}

final class AppUpdateRelease {
  const AppUpdateRelease({
    required this.version,
    required this.name,
    required this.releaseUri,
    required this.downloadUri,
  });

  final String version;
  final String name;
  final Uri releaseUri;
  final Uri downloadUri;
}

final class AppUpdateException implements Exception {
  const AppUpdateException(this.message, [this.cause]);

  final String message;
  final Object? cause;

  @override
  String toString() => 'AppUpdateException($message)';
}

final class AppUpdateService {
  AppUpdateService({
    required TuneFreeHttpClient httpClient,
    PackageInfoLoader? packageInfoLoader,
    this.repositoryOwner = 'alanbulan',
    this.repositoryName = 'TuneFree_Mobile',
  }) : _httpClient = httpClient,
       _packageInfoLoader = packageInfoLoader ?? PackageInfo.fromPlatform;

  final TuneFreeHttpClient _httpClient;
  final PackageInfoLoader _packageInfoLoader;
  final String repositoryOwner;
  final String repositoryName;

  Future<AppUpdateInfo> checkForUpdate() async {
    final packageInfo = await _packageInfoLoader();
    final release = await fetchLatestRelease();
    return AppUpdateInfo(
      currentVersion: packageInfo.version,
      latestVersion: release.version,
      releaseName: release.name,
      releaseUri: release.releaseUri,
      downloadUri: release.downloadUri,
      hasUpdate: isVersionNewer(release.version, packageInfo.version),
    );
  }

  Future<AppUpdateRelease> fetchLatestRelease() async {
    try {
      final response = await _httpClient.dio.getUri<Object?>(
        Uri.https(
          'api.github.com',
          '/repos/$repositoryOwner/$repositoryName/releases/latest',
        ),
        options: Options(
          headers: const <String, String>{
            'Accept': 'application/vnd.github+json',
          },
        ),
      );
      return parseLatestRelease(_readResponseMap(response.data));
    } catch (error) {
      if (error is AppUpdateException) {
        rethrow;
      }
      throw AppUpdateException('Failed to check latest release.', error);
    }
  }

  static AppUpdateRelease parseLatestRelease(Map<String, dynamic> json) {
    final rawTag = json['tag_name'];
    final releaseUrl = Uri.tryParse(json['html_url'] as String? ?? '');
    if (rawTag is! String || rawTag.trim().isEmpty || releaseUrl == null) {
      throw const AppUpdateException('Invalid GitHub release payload.');
    }

    final downloadUri = _readApkAssetUri(json['assets']) ?? releaseUrl;
    final name = json['name'] as String?;
    return AppUpdateRelease(
      version: normalizeVersion(rawTag),
      name: name == null || name.trim().isEmpty ? rawTag : name.trim(),
      releaseUri: releaseUrl,
      downloadUri: downloadUri,
    );
  }

  static String normalizeVersion(String value) {
    var normalized = value.trim();
    if (normalized.startsWith('v') || normalized.startsWith('V')) {
      normalized = normalized.substring(1);
    }
    return normalized;
  }

  static bool isVersionNewer(String latest, String current) {
    final latestParts = _parseVersionParts(latest);
    final currentParts = _parseVersionParts(current);
    final length = latestParts.length > currentParts.length
        ? latestParts.length
        : currentParts.length;
    for (var index = 0; index < length; index += 1) {
      final latestPart = index < latestParts.length ? latestParts[index] : 0;
      final currentPart = index < currentParts.length ? currentParts[index] : 0;
      if (latestPart > currentPart) {
        return true;
      }
      if (latestPart < currentPart) {
        return false;
      }
    }
    return false;
  }

  static Map<String, dynamic> _readResponseMap(Object? data) {
    if (data is Map<String, dynamic>) {
      return data;
    }
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    if (data is String) {
      final decoded = jsonDecode(data);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
      if (decoded is Map) {
        return Map<String, dynamic>.from(decoded);
      }
    }
    throw const AppUpdateException('Invalid GitHub release payload.');
  }

  static Uri? _readApkAssetUri(Object? rawAssets) {
    if (rawAssets is! List) {
      return null;
    }

    for (final asset in rawAssets) {
      if (asset is! Map) {
        continue;
      }
      final name = asset['name'] as String?;
      final url = asset['browser_download_url'] as String?;
      if (name == null || url == null || !name.toLowerCase().endsWith('.apk')) {
        continue;
      }
      final uri = Uri.tryParse(url);
      if (uri != null) {
        return uri;
      }
    }
    return null;
  }

  static List<int> _parseVersionParts(String value) {
    final normalized = normalizeVersion(
      value,
    ).split('+').first.split('-').first;
    return normalized
        .split('.')
        .map((part) => int.tryParse(part) ?? 0)
        .toList(growable: false);
  }

  Future<String> downloadApk(
    String url,
    void Function(int received, int total) onProgress,
  ) async {
    final dir = await getExternalStorageDirectory();
    if (dir == null) {
      throw const AppUpdateException('Cannot access external storage.');
    }
    final updatesDir = Directory('${dir.path}/updates');
    if (!updatesDir.existsSync()) {
      updatesDir.createSync(recursive: true);
    }
    final savePath = '${updatesDir.path}/tunefree.apk';

    try {
      await _httpClient.dio.download(
        url,
        savePath,
        onReceiveProgress: onProgress,
      );
    } catch (error) {
      throw AppUpdateException('APK download failed.', error);
    }

    return savePath;
  }
}
