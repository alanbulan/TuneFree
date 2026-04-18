import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'download_record.dart';

typedef DownloadFileExists = Future<bool> Function(String path);

abstract class DownloadRecordStore {
  Future<DownloadRecord?> load({required String songKey, required String quality});
  Future<List<DownloadRecord>> listAll();
  Future<List<DownloadRecord>> listBySongKey(String songKey);
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
    final records = await _loadRecordMap(preferences);
    final recordKey = _recordKey(songKey, quality);
    final json = records[recordKey];
    if (json is! Map<String, dynamic>) {
      return null;
    }

    final record = DownloadRecord.fromJson(json);
    if (_isInvalidRecord(record) || !(await _isDownloadFileAvailable(record.filePath))) {
      records.remove(recordKey);
      await _persistRecordMap(preferences, records);
      return null;
    }

    return record;
  }

  @override
  Future<List<DownloadRecord>> listAll() async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    final entries = <DownloadRecord>[];
    var changed = false;

    for (final entry in records.entries.toList(growable: false)) {
      final json = entry.value;
      if (json is! Map<String, dynamic>) {
        records.remove(entry.key);
        changed = true;
        continue;
      }
      final record = DownloadRecord.fromJson(json);
      if (_isInvalidRecord(record) || !(await _isDownloadFileAvailable(record.filePath))) {
        records.remove(entry.key);
        changed = true;
        continue;
      }
      entries.add(record);
    }

    if (changed) {
      await _persistRecordMap(preferences, records);
    }

    entries.sort((a, b) => b.downloadedAtIso8601.compareTo(a.downloadedAtIso8601));
    return entries;
  }

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async {
    final records = await listAll();
    return records.where((record) => record.songKey == songKey).toList(growable: false);
  }

  @override
  Future<void> save(DownloadRecord record) async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    records[_recordKey(record.songKey, record.quality)] = record.toJson();
    await _persistRecordMap(preferences, records);
  }

  @override
  Future<void> remove({required String songKey, required String quality}) async {
    final preferences = await SharedPreferences.getInstance();
    final records = await _loadRecordMap(preferences);
    records.remove(_recordKey(songKey, quality));
    await _persistRecordMap(preferences, records);
  }

  Future<Map<String, dynamic>> _loadRecordMap(SharedPreferences preferences) async {
    final rawValue = preferences.getString(_storageKey);
    if (rawValue == null || rawValue.isEmpty) {
      return <String, dynamic>{};
    }
    try {
      final decoded = jsonDecode(rawValue);
      if (decoded is Map<String, dynamic>) {
        return decoded;
      }
    } catch (error) {
      debugPrint('SharedPreferencesDownloadRecordStore decode failed: $error');
    }
    await preferences.remove(_storageKey);
    return <String, dynamic>{};
  }

  Future<void> _persistRecordMap(
    SharedPreferences preferences,
    Map<String, dynamic> records,
  ) {
    return preferences.setString(_storageKey, jsonEncode(records));
  }

  Future<bool> _isDownloadFileAvailable(String filePath) async {
    try {
      return await fileExists(filePath);
    } catch (_) {
      return false;
    }
  }

  bool _isInvalidRecord(DownloadRecord record) {
    return record.songKey.isEmpty ||
        record.songId.isEmpty ||
        record.filePath.isEmpty ||
        record.quality.isEmpty ||
        record.downloadedAtIso8601.isEmpty;
  }

  String _recordKey(String songKey, String quality) => '$songKey::$quality';
}
