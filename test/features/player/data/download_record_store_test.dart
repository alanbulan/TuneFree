import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';

void main() {
  test('record store saves, reloads, and removes stale records', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{});

    final store = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async => path.endsWith('present.flac'),
    );

    const record = DownloadRecord(
      songKey: 'netease:123456',
      songId: '123456',
      songName: '海与你',
      artist: '马也_Crabbit',
      quality: 'flac',
      filePath: '/downloads/present.flac',
      fileName: '马也_Crabbit - 海与你 [netease-123456].flac',
      downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
    );

    await store.save(record);
    final loaded = await store.load(songKey: 'netease:123456', quality: 'flac');
    expect(loaded?.filePath, '/downloads/present.flac');

    await store.save(
      const DownloadRecord(
        songKey: 'netease:123456',
        songId: '123456',
        songName: '海与你',
        artist: '马也_Crabbit',
        quality: '320k',
        filePath: '/downloads/missing.mp3',
        fileName: 'missing.mp3',
        downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
      ),
    );

    final stale = await store.load(songKey: 'netease:123456', quality: '320k');
    expect(stale, isNull);
  });

  test('record store lists all records, removes records, and recovers from malformed storage', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'player_download_records_v1': 'not-json',
    });
    final store = SharedPreferencesDownloadRecordStore.test(
      fileExists: (_) async => true,
    );

    final malformedList = await store.listAll();
    expect(malformedList, isEmpty);

    const flacRecord = DownloadRecord(
      songKey: 'netease:123456',
      songId: '123456',
      songName: '海与你',
      artist: '马也_Crabbit',
      quality: 'flac',
      filePath: '/downloads/song.flac',
      fileName: 'song.flac',
      downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
    );
    const mp3Record = DownloadRecord(
      songKey: 'netease:123456',
      songId: '123456',
      songName: '海与你',
      artist: '马也_Crabbit',
      quality: '320k',
      filePath: '/downloads/song.mp3',
      fileName: 'song.mp3',
      downloadedAtIso8601: '2026-04-17T10:00:01.000Z',
    );

    await store.save(flacRecord);
    await store.save(mp3Record);

    final listed = await store.listAll();
    expect(listed.map((record) => record.quality), <String>['320k', 'flac']);

    await store.remove(songKey: 'netease:123456', quality: '320k');
    final afterRemove = await store.listAll();
    expect(afterRemove.map((record) => record.quality), <String>['flac']);
  });

  test('record store treats file existence check failures as stale in load', () async {
    const staleRecord = DownloadRecord(
      songKey: 'netease:123456',
      songId: '123456',
      songName: '海与你',
      artist: '马也_Crabbit',
      quality: 'flac',
      filePath: '/downloads/throws.flac',
      fileName: 'song.flac',
      downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
    );
    SharedPreferences.setMockInitialValues(<String, Object>{
      'player_download_records_v1': jsonEncode({
        'netease:123456::flac': staleRecord.toJson(),
      }),
    });

    final store = SharedPreferencesDownloadRecordStore.test(
      fileExists: (_) async {
        throw Exception('filesystem unavailable');
      },
    );

    final loaded = await store.load(songKey: 'netease:123456', quality: 'flac');
    expect(loaded, isNull);

    final preferences = await SharedPreferences.getInstance();
    final persistedValue = preferences.getString('player_download_records_v1');
    final persistedRecords = persistedValue == null ? <String, dynamic>{} : jsonDecode(persistedValue) as Map<String, dynamic>;
    expect(persistedRecords, isEmpty);
  });

  test('record store treats file existence check failures as stale in listAll', () async {
    const staleRecord = DownloadRecord(
      songKey: 'netease:123456',
      songId: '123456',
      songName: '海与你',
      artist: '马也_Crabbit',
      quality: 'flac',
      filePath: '/downloads/throws.flac',
      fileName: 'song.flac',
      downloadedAtIso8601: '2026-04-17T10:00:00.000Z',
    );
    const healthyRecord = DownloadRecord(
      songKey: 'netease:654321',
      songId: '654321',
      songName: '存在',
      artist: '乐队',
      quality: 'mp3',
      filePath: '/downloads/present.mp3',
      fileName: 'song.mp3',
      downloadedAtIso8601: '2026-04-17T10:00:01.000Z',
    );
    SharedPreferences.setMockInitialValues(<String, Object>{
      'player_download_records_v1': jsonEncode({
        'netease:123456::flac': staleRecord.toJson(),
        'netease:654321::mp3': healthyRecord.toJson(),
      }),
    });

    final store = SharedPreferencesDownloadRecordStore.test(
      fileExists: (path) async {
        if (path == '/downloads/throws.flac') {
          throw Exception('filesystem unavailable');
        }
        return path == '/downloads/present.mp3';
      },
    );

    final listed = await store.listAll();
    expect(listed.map((record) => record.quality), ['mp3']);
    expect(listed.single.songKey, 'netease:654321');

    final preferences = await SharedPreferences.getInstance();
    final persistedValue = preferences.getString('player_download_records_v1');
    final persistedRecords = persistedValue == null ? <String, dynamic>{} : jsonDecode(persistedValue) as Map<String, dynamic>;
    expect(persistedRecords.keys, ['netease:654321::mp3']);
  });
}
