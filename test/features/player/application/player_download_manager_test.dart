import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_file_store.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';
import 'package:tunefree/features/player/data/player_download_manager.dart';
import 'package:tunefree/features/player/data/song_resolution_repository.dart';

void main() {
  test(
    'download manager downloads the song once and reuses an existing record later',
    () async {
      SharedPreferences.setMockInitialValues(<String, Object>{});
      final rootDirectory = await Directory.systemTemp.createTemp(
        'tf-download-manager-',
      );
      final fileStore = DownloadFileStore.test(rootDirectory: rootDirectory);
      final recordStore = SharedPreferencesDownloadRecordStore.test(
        fileExists: (path) async => File(path).exists(),
      );
      final service = PlayerDownloadManager(
        httpBytes: (url) async => utf8.encode('audio-bytes'),
        fileStore: fileStore,
        recordStore: recordStore,
        songResolutionRepository: SongResolutionRepository.test(
          resolveSongValue: (song, quality) async =>
              song.copyWith(url: 'https://example.com/song.flac'),
        ),
      );
      addTearDown(() async {
        await fileStore.deleteTestRoot();
      });

      const song = Song(
        id: 'download-song',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      );

      final first = await service.downloadSong(song, AudioQuality.flac);
      expect(first.alreadyExisted, isFalse);
      expect(await File(first.filePath).exists(), isTrue);

      final second = await service.downloadSong(song, AudioQuality.flac);
      expect(second.alreadyExisted, isTrue);
      expect(second.filePath, first.filePath);
    },
  );

  test('stale records do not block a fresh download when the file is missing', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final rootDirectory = await Directory.systemTemp.createTemp(
      'tf-stale-download-',
    );
    final fileStore = DownloadFileStore.test(rootDirectory: rootDirectory);
    final recordStore = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async => File(path).exists(),
    );
    final manager = PlayerDownloadManager(
      httpBytes: (url) async => utf8.encode('fresh-bytes'),
      fileStore: fileStore,
      recordStore: recordStore,
      songResolutionRepository: SongResolutionRepository.test(
        resolveSongValue: (song, quality) async =>
            song.copyWith(url: 'https://example.com/song.flac'),
      ),
    );
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    await recordStore.save(
      const DownloadRecord(
        songKey: 'netease:stale-song',
        songId: 'stale-song',
        songName: '旧记录',
        artist: 'TuneFree',
        quality: 'flac',
        filePath: '/missing/file.flac',
        fileName: 'missing.flac',
        downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
      ),
    );

    const song = Song(
      id: 'stale-song',
      name: '旧记录',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );

    final result = await manager.downloadSong(song, AudioQuality.flac);

    expect(result.alreadyExisted, isFalse);
    expect(await File(result.filePath).exists(), isTrue);
  });
}
