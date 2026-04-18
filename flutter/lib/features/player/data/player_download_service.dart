import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import '../../../core/network/tune_free_http_client.dart';
import 'download_file_store.dart';
import 'download_record_store.dart';
import 'player_download_manager.dart';
import 'song_resolution_repository.dart';

final downloadFileStoreProvider = Provider<DownloadFileStore>((ref) {
  return DownloadFileStore.real();
});

final downloadRecordStoreProvider = Provider<DownloadRecordStore>((ref) {
  final fileStore = ref.watch(downloadFileStoreProvider);
  return SharedPreferencesDownloadRecordStore.real(
    fileExists: fileStore.fileExists,
  );
});

final playerDownloadServiceProvider = Provider<PlayerDownloadService>((ref) {
  final httpClient = TuneFreeHttpClient();
  return PlayerDownloadService.real(
    manager: PlayerDownloadManager(
      httpBytes: (url) async {
        final response = await httpClient.dio.get<List<int>>(
          url,
          options: Options(responseType: ResponseType.bytes),
        );
        final data = response.data;
        if (data == null) {
          throw StateError('download response body missing');
        }
        return data;
      },
      fileStore: ref.watch(downloadFileStoreProvider),
      recordStore: ref.watch(downloadRecordStoreProvider),
      songResolutionRepository: ref.watch(songResolutionRepositoryProvider),
    ),
  );
});

class PlayerDownloadService {
  const PlayerDownloadService._({
    required PlayerDownloadManager manager,
    this.downloadOverride,
  }) : _manager = manager;

  factory PlayerDownloadService.real({
    required PlayerDownloadManager manager,
  }) => PlayerDownloadService._(manager: manager);

  factory PlayerDownloadService.test({
    Future<DownloadResult> Function(Song song, AudioQuality quality)? download,
  }) => PlayerDownloadService._(
    manager: PlayerDownloadManager(
      httpBytes: (_) async => const <int>[],
      fileStore: DownloadFileStore.test(
        rootDirectory: Directory.systemTemp.createTempSync(
          'unused-download-root',
        ),
      ),
      recordStore: SharedPreferencesDownloadRecordStore.test(
        fileExists: (_) async => false,
      ),
      songResolutionRepository: SongResolutionRepository.test(
        resolveSongValue: (song, quality) async => song,
      ),
    ),
    downloadOverride: download,
  );

  final PlayerDownloadManager _manager;
  final Future<DownloadResult> Function(Song song, AudioQuality quality)?
  downloadOverride;

  Future<DownloadResult> downloadSong(Song song, AudioQuality quality) async {
    final override = downloadOverride;
    if (override != null) {
      return override(song, quality);
    }
    return _manager.downloadSong(song, quality);
  }
}
