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
  test('download manager downloads the song once and reuses an existing record later', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final rootDirectory = await Directory.systemTemp.createTemp(
      'tf-download-manager-',
    );
    final fileStore = DownloadFileStore.test(rootDirectory: rootDirectory);
    final recordStore = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async => File(path).exists(),
    );
    var resolutions = 0;
    var requests = 0;
    final service = PlayerDownloadManager(
      httpBytes: (url) async {
        requests += 1;
        return utf8.encode('audio-bytes');
      },
      fileStore: fileStore,
      recordStore: recordStore,
      songResolutionRepository: SongResolutionRepository.test(
        resolveSongValue: (song, quality) async {
          resolutions += 1;
          return song.copyWith(url: 'https://example.com/song.flac');
        },
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
    expect(resolutions, 1);
    expect(requests, 1);
  });

  test(
    'stale records do not block a fresh download when the file is missing',
    () async {
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
    },
  );

  test('new downloads resolve the current endpoint and selected quality despite an old playback URL', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});
    final rootDirectory = await Directory.systemTemp.createTemp(
      'tf-download-source-switch-',
    );
    final fileStore = DownloadFileStore.test(rootDirectory: rootDirectory);
    final recordStore = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async => File(path).exists(),
    );
    addTearDown(fileStore.deleteTestRoot);
    final downloadedUrls = <String>[];
    String? resolvedQuality;
    final manager = PlayerDownloadManager(
      httpBytes: (url) async {
        downloadedUrls.add(url);
        return utf8.encode('current-source-flac');
      },
      fileStore: fileStore,
      recordStore: recordStore,
      songResolutionRepository: SongResolutionRepository.test(
        resolveSongValue: (song, quality) async {
          resolvedQuality = quality;
          return song.copyWith(
            url: 'https://current.example/song.flac',
            pic: 'https://current.example/cover.png',
          );
        },
      ),
    );
    const playingSong = Song(
      id: 'switch-song',
      name: '切换音源',
      artist: 'TuneFree',
      source: MusicSource.netease,
      url: 'https://previous.example/song-128k.mp3',
    );

    final result = await manager.downloadSong(playingSong, AudioQuality.flac);

    expect(resolvedQuality, 'flac');
    expect(downloadedUrls, ['https://current.example/song.flac']);
    expect(await File(result.filePath).readAsString(), 'current-source-flac');
    final record = await recordStore.load(
      songKey: playingSong.key,
      quality: 'flac',
    );
    expect(record?.artworkUrl, 'https://current.example/cover.png');
  });
}
