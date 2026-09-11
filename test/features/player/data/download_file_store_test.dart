import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/audio_quality.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/features/player/data/download_file_store.dart';

/// 统一成正斜杠，好在 Windows 上比较目录列举出来的路径。
String _slashes(String path) => path.replaceAll(r'\', '/');

void main() {
  test(
    'file store builds sanitized final and temp paths in app-private audio directory',
    () async {
      final fileStore = DownloadFileStore.test(
        rootDirectory: await Directory.systemTemp.createTemp('tf-downloads-'),
      );
      addTearDown(() async {
        await fileStore.deleteTestRoot();
      });

      const song = Song(
        id: '123456',
        name: '海与你 / Live?',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      );

      final target = await fileStore.createTarget(
        song: song,
        quality: AudioQuality.flac,
      );

      expect(target.finalFile.path, contains('downloads'));
      expect(target.finalFile.path, contains('audio'));
      expect(target.finalFile.path, contains('[netease-123456].flac'));
      expect(target.finalFile.path, isNot(contains('/ Live?')));
      expect(target.temporaryFile.path, endsWith('.download'));
    },
  );

  test('file store deletes final files and reports file existence', () async {
    final fileStore = DownloadFileStore.test(
      rootDirectory: await Directory.systemTemp.createTemp(
        'tf-downloads-delete-',
      ),
    );
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    const song = Song(
      id: 'delete-song',
      name: '删除测试',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );

    final target = await fileStore.createTarget(
      song: song,
      quality: AudioQuality.flac,
    );
    await target.finalFile.create(recursive: true);
    await target.finalFile.writeAsString('bytes');

    expect(await fileStore.fileExists(target.finalFile.path), isTrue);
    await fileStore.deleteFinalFile(target.finalFile.path);
    expect(await fileStore.fileExists(target.finalFile.path), isFalse);
  });

  test('回收站原语：挪进去、列出来、再挪回去', () async {
    final fileStore = DownloadFileStore.test(
      rootDirectory: await Directory.systemTemp.createTemp('tf-trash-'),
    );
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    const song = Song(
      id: 'trash-song',
      name: '回收站测试',
      artist: 'TuneFree',
      source: MusicSource.netease,
    );
    final target = await fileStore.createTarget(
      song: song,
      quality: AudioQuality.flac,
    );
    await target.finalFile.create(recursive: true);
    await target.finalFile.writeAsString('bytes');

    final trashDirectory = await fileStore.trashDirectoryPath();
    final trashed = '$trashDirectory/1780000000000__${target.fileName}';

    await fileStore.moveFile(from: target.finalFile.path, to: trashed);

    expect(await fileStore.fileExists(target.finalFile.path), isFalse);
    expect(await fileStore.fileExists(trashed), isTrue);
    // 目录列举会用平台自己的分隔符（Windows 上是反斜杠），而回收站路径是拼
    // 出来的正斜杠。生产目标是 Android / iOS，两边都是正斜杠；比较前归一化。
    expect((await fileStore.listFiles(trashDirectory)).map(_slashes), <String>[
      _slashes(trashed),
    ]);

    await fileStore.moveFile(from: trashed, to: target.finalFile.path);

    expect(await fileStore.fileExists(target.finalFile.path), isTrue);
    expect(await fileStore.listFiles(trashDirectory), isEmpty);
    // 是挪动而不是复制：内容原样带回来。
    expect(await target.finalFile.readAsString(), 'bytes');
  });

  test('回收站目录还不存在时列出空列表，不抛错', () async {
    final fileStore = DownloadFileStore.test(
      rootDirectory: await Directory.systemTemp.createTemp('tf-trash-empty-'),
    );
    addTearDown(() async {
      await fileStore.deleteTestRoot();
    });

    // 一次都没删过的时候回收站是没建过的，这不是错误。
    expect(
      await fileStore.listFiles(await fileStore.trashDirectoryPath()),
      isEmpty,
    );
  });
}
