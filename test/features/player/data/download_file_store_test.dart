import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_file_store.dart';

void main() {
  test('file store builds sanitized final and temp paths in app-private audio directory', () async {
    final fileStore = DownloadFileStore.test(rootDirectory: await Directory.systemTemp.createTemp('tf-downloads-'));
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    const song = Song(
      id: '123456',
      name: '海与你 / Live?',
      artist: '马也_Crabbit',
      source: MusicSource.netease,
    );

    final target = await fileStore.createTarget(song: song, quality: AudioQuality.flac);

    expect(target.finalFile.path, contains('downloads'));
    expect(target.finalFile.path, contains('audio'));
    expect(target.finalFile.path, contains('[netease-123456].flac'));
    expect(target.finalFile.path, isNot(contains('/ Live?')));
    expect(target.temporaryFile.path, endsWith('.download'));
  });
}
