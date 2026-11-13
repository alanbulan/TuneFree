import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';

import 'music_api_settings.dart';

abstract class MusicApiStore {
  Future<MusicApiSettings> load();
  Future<void> save(MusicApiSettings settings);
}

final class SharedPreferencesMusicApiStore implements MusicApiStore {
  static const storageKey = 'tunefree_music_api_settings';

  @override
  Future<MusicApiSettings> load() async {
    final preferences = await SharedPreferences.getInstance();
    final raw = preferences.getString(storageKey);
    if (raw == null || raw.isEmpty) {
      return const MusicApiSettings();
    }
    final decoded = jsonDecode(raw);
    if (decoded is! Map<String, dynamic>) {
      throw const FormatException('Invalid music API settings');
    }
    return MusicApiSettings.fromJson(decoded);
  }

  @override
  Future<void> save(MusicApiSettings settings) async {
    final preferences = await SharedPreferences.getInstance();
    final saved = await preferences.setString(
      storageKey,
      jsonEncode(settings.toJson()),
    );
    if (!saved) {
      throw StateError('Music API settings could not be saved');
    }
  }
}
