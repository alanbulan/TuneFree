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
}
