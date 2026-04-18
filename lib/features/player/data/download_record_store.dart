import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'download_record.dart';

typedef DownloadFileExists = Future<bool> Function(String path);

abstract class DownloadRecordStore {
  Future<DownloadRecord?> load({required String songKey, required String quality});
  Future<void> save(DownloadRecord record);
  Future<void> remove({required String songKey, required String quality});
}

class SharedPreferencesDownloadRecordStore implements DownloadRecordStore {
  const SharedPreferencesDownloadRecordStore._({required this.fileExists});

  factory SharedPreferencesDownloadRecordStore.real({required DownloadFileExists fileExists}) {
    return SharedPreferencesDownloadRecordStore._(fileExists: fileExists);
  }

  factory SharedPreferencesDownloadRecordStore.test({required DownloadFileExists fileExists}) {
    return SharedPreferencesDownloadRecordStore._(fileExists: fileExists);
  }

  static const String _storageKey = 'player_download_records_v1';

  final DownloadFileExists fileExists;

  @override
  Future<DownloadRecord?> load({required String songKey, required String quality}) async {
    final preferences = await SharedPreferences.getInstance();
    final records = _decodeRecords(preferences.getString(_storageKey));
    final recordKey = _recordKey(songKey, quality);
    final json = records[recordKey];
    if (json is! Map<String, dynamic>) {
      return null;
    }

    final record = DownloadRecord.fromJson(json);
    if (!await fileExists(record.filePath)) {
      records.remove(recordKey);
      await preferences.setString(_storageKey, jsonEncode(records));
      return null;
    }

    return record;
  }

  @override
  Future<void> save(DownloadRecord record) async {
    final preferences = await SharedPreferences.getInstance();
    final records = _decodeRecords(preferences.getString(_storageKey));
    records[_recordKey(record.songKey, record.quality)] = record.toJson();
    await preferences.setString(_storageKey, jsonEncode(records));
  }

  @override
  Future<void> remove({required String songKey, required String quality}) async {
    final preferences = await SharedPreferences.getInstance();
    final records = _decodeRecords(preferences.getString(_storageKey));
    records.remove(_recordKey(songKey, quality));
    await preferences.setString(_storageKey, jsonEncode(records));
  }

  Map<String, dynamic> _decodeRecords(String? rawValue) {
    if (rawValue == null || rawValue.isEmpty) {
      return <String, dynamic>{};
    }
    final decoded = jsonDecode(rawValue);
    if (decoded is Map<String, dynamic>) {
      return decoded;
    }
    return <String, dynamic>{};
  }

  String _recordKey(String songKey, String quality) => '$songKey::$quality';
}
