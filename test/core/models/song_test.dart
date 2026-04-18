import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/parsed_lyric.dart';
import 'package:tunefree/core/models/playlist.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';

void main() {
  test('song key and JSON mapping mirror the legacy model', () {
    final song = Song.fromJson(const {
      'id': '123',
      'name': '海与你',
      'artist': '马也_Crabbit',
      'album': '单曲',
      'source': 'netease',
      'types': ['128k', '320k', 'flac'],
      'pic': 'https://example.com/cover.jpg',
      'lrc': '[00:00.00]海与你',
    });

    expect(song.key, 'netease:123');
    expect(song.audioQualities, [AudioQuality.k128, AudioQuality.k320, AudioQuality.flac]);
    expect(song.source, MusicSource.netease);
    expect(song.toJson()['artist'], '马也_Crabbit');
  });

  test('song preserves unknown source wire values across JSON round-trips', () {
    final song = Song.fromJson(const {
      'id': '42',
      'name': 'Unknown Source Song',
      'artist': 'Mystery Artist',
      'source': 'spotify',
    });

    expect(song.source.wireValue, 'spotify');
    expect(song.source, isNot(MusicSource.unknown));
    expect(song.key, 'spotify:42');
    expect(song.toJson()['source'], 'spotify');
  });

  test('top list JSON keeps legacy field names', () {
    final topList = TopList.fromJson(const {
      'id': 'top-1',
      'name': '热歌榜',
      'updateFrequency': '每周五',
      'picUrl': 'https://example.com/pic.jpg',
      'coverImgUrl': 'https://example.com/cover.jpg',
    });

    expect(topList.toJson(), const {
      'id': 'top-1',
      'name': '热歌榜',
      'updateFrequency': '每周五',
      'picUrl': 'https://example.com/pic.jpg',
      'coverImgUrl': 'https://example.com/cover.jpg',
    });
  });

  test('playlist JSON keeps createTime and nested song source values', () {
    final playlist = Playlist.fromJson(const {
      'id': 'playlist-1',
      'name': '收藏歌单',
      'createTime': 1710000000,
      'songs': [
        {
          'id': 'song-1',
          'name': 'Imported Track',
          'artist': 'Guest Artist',
          'source': 'migu',
        },
      ],
    });

    final json = jsonDecode(jsonEncode(playlist.toJson())) as Map<String, dynamic>;

    expect(json['createTime'], 1710000000);
    expect((json['songs'] as List).single['source'], 'migu');
  });

  test('parsed lyric JSON preserves translation and numeric time', () {
    final parsedLyric = ParsedLyric.fromJson(const {
      'time': 12.5,
      'text': '海与你',
      'translation': 'Sea and You',
    });

    expect(parsedLyric.toJson(), const {
      'time': 12.5,
      'text': '海与你',
      'translation': 'Sea and You',
    });
  });
}
