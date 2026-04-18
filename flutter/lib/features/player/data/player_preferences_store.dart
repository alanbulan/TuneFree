import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/song.dart';
import '../application/player_queue_manager.dart';

abstract class PlayerPreferencesStore {
  Future<Song?> loadCurrentSong();
  Future<void> saveCurrentSong(Song? value);
  Future<List<Song>> loadQueue();
  Future<void> saveQueue(List<Song> value);
  Future<String> loadPlayMode();
  Future<void> savePlayMode(String value);
  Future<AudioQuality> loadAudioQuality();
  Future<void> saveAudioQuality(AudioQuality value);
}

final playerPreferencesStoreProvider = Provider<PlayerPreferencesStore>((ref) {
  return SharedPreferencesPlayerPreferencesStore();
});

final class SharedPreferencesPlayerPreferencesStore implements PlayerPreferencesStore {
  static const String _currentSongKey = 'player.currentSong';
  static const String _queueKey = 'player.queue';
  static const String _playModeKey = 'player.playMode';
  static const String _audioQualityKey = 'player.audioQuality';

  SharedPreferencesPlayerPreferencesStore({Future<SharedPreferences>? sharedPreferences})
    : _sharedPreferences = sharedPreferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _sharedPreferences;

  @override
  Future<AudioQuality> loadAudioQuality() async {
    final preferences = await _sharedPreferences;
    final rawValue = preferences.getString(_audioQualityKey);
    if (rawValue == null || rawValue.isEmpty) {
      return AudioQuality.k320;
    }

    return AudioQualityWire.fromWire(rawValue);
  }

  @override
  Future<Song?> loadCurrentSong() async {
    final preferences = await _sharedPreferences;
    final rawValue = preferences.getString(_currentSongKey);
    if (rawValue == null || rawValue.isEmpty) {
      return null;
    }

    return _decodeSong(rawValue, storageKey: _currentSongKey);
  }

  @override
  Future<String> loadPlayMode() async {
    final preferences = await _sharedPreferences;
    final rawValue = preferences.getString(_playModeKey);
    if (rawValue == null || rawValue.isEmpty) {
      return sequencePlayMode;
    }

    return normalizePlayMode(rawValue);
  }

  @override
  Future<List<Song>> loadQueue() async {
    final preferences = await _sharedPreferences;
    final rawValues = preferences.getStringList(_queueKey) ?? const <String>[];

    return List<Song>.unmodifiable(
      rawValues
          .map((rawValue) => _decodeSong(rawValue, storageKey: _queueKey))
          .whereType<Song>(),
    );
  }

  @override
  Future<void> saveAudioQuality(AudioQuality value) async {
    final preferences = await _sharedPreferences;
    await preferences.setString(_audioQualityKey, value.wireValue);
  }

  @override
  Future<void> saveCurrentSong(Song? value) async {
    final preferences = await _sharedPreferences;
    if (value == null) {
      await preferences.remove(_currentSongKey);
      return;
    }

    await preferences.setString(_currentSongKey, jsonEncode(value.toJson()));
  }

  @override
  Future<void> savePlayMode(String value) async {
    final preferences = await _sharedPreferences;
    await preferences.setString(_playModeKey, normalizePlayMode(value));
  }

  @override
  Future<void> saveQueue(List<Song> value) async {
    final preferences = await _sharedPreferences;
    final encodedQueue = value.map((song) => jsonEncode(song.toJson())).toList(growable: false);
    await preferences.setStringList(_queueKey, encodedQueue);
  }

  Song? _decodeSong(String rawValue, {required String storageKey}) {
    try {
      final decoded = jsonDecode(rawValue);
      if (decoded is! Map<String, dynamic>) {
        _logDecodeFailure(storageKey, 'expected JSON object payload');
        return null;
      }
      return Song.fromJson(decoded);
    } catch (error) {
      _logDecodeFailure(storageKey, error.toString());
      return null;
    }
  }

  void _logDecodeFailure(String storageKey, String reason) {
    debugPrint('PlayerPreferencesStore failed to decode $storageKey: $reason');
  }
}
