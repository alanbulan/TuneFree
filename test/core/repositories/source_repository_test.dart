import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/data/top_list_repository.dart';
import 'package:tunefree/features/library/data/playlist_import_repository.dart';
import 'package:tunefree/features/search/data/search_repository.dart';

final class _TestPlaylistImportClient implements PlaylistImportClient {
  _TestPlaylistImportClient(this._handler);

  final Future<PlaylistImportPayload?> Function(String source, String id)
  _handler;
  final List<String> calls = <String>[];

  @override
  Future<PlaylistImportPayload?> importPlaylist(String source, String id) {
    calls.add('$source:$id');
    return _handler(source, id);
  }
}

void main() {
  test(
    'aggregate search interleaves source results and tolerates failures',
    () async {
      final repository = SearchRepository.test(
        neteaseSearch: (_, page) async => [
          Song(
            id: 'n1',
            name: '网易歌曲',
            artist: '歌手A',
            source: MusicSource.netease,
          ),
        ],
        qqSearch: (_, page) async => [
          Song(id: 'q1', name: 'QQ歌曲', artist: '歌手B', source: MusicSource.qq),
        ],
        kuwoSearch: (_, page) async => throw Exception('offline'),
      );

      final result = await repository.searchAggregate('test', page: 1);

      expect(result.map((song) => song.key).toList(), ['netease:n1', 'qq:q1']);
    },
  );

  test('search repository treats GD-backed sources as default peers', () async {
    final repository = SearchRepository.test(
      neteaseSearch: (_, page) async => [
        Song(
          id: 'n$page',
          name: '网易歌曲',
          artist: '歌手A',
          source: MusicSource.netease,
        ),
      ],
      qqSearch: (_, page) async => [
        Song(id: 'q$page', name: 'QQ歌曲', artist: '歌手B', source: MusicSource.qq),
      ],
      kuwoSearch: (_, page) async => [
        Song(
          id: 'k$page',
          name: '酷我歌曲',
          artist: '歌手C',
          source: MusicSource.kuwo,
        ),
      ],
      jooxSearch: (_, page) async => [
        Song(
          id: 'j$page',
          name: 'JOOX歌曲',
          artist: 'JOOX',
          source: MusicSource.joox,
        ),
      ],
      bilibiliSearch: (_, page) async => [
        Song(
          id: 'b$page',
          name: 'Bilibili歌曲',
          artist: 'Bilibili',
          source: MusicSource.bilibili,
        ),
      ],
    );

    final defaultResult = await repository.searchAggregate('test', page: 1);
    final repeatedResult = await repository.searchAggregate('test', page: 1);
    final singleResult = await repository.searchSingle(
      'test',
      source: 'joox',
      page: 2,
    );

    expect(defaultResult.map((song) => song.key).toList(), [
      'netease:n1',
      'qq:q1',
      'kuwo:k1',
      'joox:j1',
      'bilibili:b1',
    ]);
    expect(repeatedResult.map((song) => song.key).toList(), [
      'netease:n1',
      'qq:q1',
      'kuwo:k1',
      'joox:j1',
      'bilibili:b1',
    ]);
    expect(singleResult.map((song) => song.key).toList(), ['joox:j2']);
  });

  test('top list repository delegates to the matching source client', () async {
    final calls = <String>[];
    final repository = TopListRepository.test(
      neteaseGetTopLists: () async {
        calls.add('netease:getTopLists');
        return const [TopList(id: 'n-top', name: '网易榜单')];
      },
      neteaseGetTopListDetail: (id) async {
        calls.add('netease:getTopListDetail:$id');
        return const [
          Song(
            id: 'n-song',
            name: '网易热歌',
            artist: '歌手A',
            source: MusicSource.netease,
          ),
        ];
      },
      qqGetTopLists: () async {
        calls.add('qq:getTopLists');
        return const [TopList(id: 'q-top', name: 'QQ榜单')];
      },
      qqGetTopListDetail: (id) async {
        calls.add('qq:getTopListDetail:$id');
        return const [
          Song(
            id: 'q-song',
            name: 'QQ热歌',
            artist: '歌手B',
            source: MusicSource.qq,
          ),
        ];
      },
      kuwoGetTopLists: () async {
        calls.add('kuwo:getTopLists');
        return const [TopList(id: 'k-top', name: '酷我榜单')];
      },
      kuwoGetTopListDetail: (id) async {
        calls.add('kuwo:getTopListDetail:$id');
        return const [
          Song(
            id: 'k-song',
            name: '酷我热歌',
            artist: '歌手C',
            source: MusicSource.kuwo,
          ),
        ];
      },
    );

    final lists = await repository.getTopLists('qq');
    final detail = await repository.getTopListDetail('kuwo', '88');

    expect(lists.map((item) => item.id).toList(), ['q-top']);
    expect(detail.map((item) => item.key).toList(), ['kuwo:k-song']);
    expect(calls, ['qq:getTopLists', 'kuwo:getTopListDetail:88']);
  });

  test(
    'playlist import repository returns imported songs with stable fallback name',
    () async {
      final calls = <String>[];
      final repository = PlaylistImportRepository.test(
        importPlaylistSongs: (source, id) async {
          calls.add('$source:$id');
          return [
            Song(
              id: 'song-1',
              name: 'Imported Track',
              artist: 'Guest Artist',
              source: MusicSource('migu'),
            ),
          ];
        },
      );

      final result = await repository.importPlaylist(
        source: 'qq',
        id: 'playlist-42',
      );

      expect(result.$1, 'playlist-42');
      expect(result.$2.map((song) => song.key).toList(), ['migu:song-1']);
      expect(calls, ['qq:playlist-42']);
    },
  );

  test('playlist import repository parses pasted playlist links', () async {
    final calls = <String>[];
    final repository = PlaylistImportRepository.payloadLoader(
      importPlaylist: (source, id) async {
        calls.add('$source:$id');
        return const (
          name: 'Remote Playlist',
          songs: <Song>[
            Song(
              id: 'song-1',
              name: 'Imported Track',
              artist: 'Guest Artist',
              source: MusicSource.netease,
            ),
          ],
        );
      },
    );

    await repository.importPlaylist(
      source: 'netease',
      id: '分享 https://music.163.com/#/playlist?id=12345&userid=9',
    );
    await repository.importPlaylist(
      source: 'qq',
      id: 'https://y.qq.com/n/ryqq/playlist/876543',
    );
    await repository.importPlaylist(
      source: 'kuwo',
      id: 'https://www.kuwo.cn/playlist_detail/24680',
    );
    await repository.importPlaylist(source: 'netease', id: '13579');

    expect(calls, <String>[
      'netease:12345',
      'qq:876543',
      'kuwo:24680',
      'netease:13579',
    ]);
  });

  test('playlist import repository rejects mismatched source links', () async {
    final repository = PlaylistImportRepository.payloadLoader(
      importPlaylist: (source, id) async => null,
    );

    expect(
      () => repository.importPlaylist(
        source: 'netease',
        id: 'https://y.qq.com/n/ryqq/playlist/876543',
      ),
      throwsA(
        isA<PlaylistImportException>().having(
          (error) => error.code,
          'code',
          PlaylistImportErrorCode.sourceMismatch,
        ),
      ),
    );
  });

  test(
    'composite playlist import client falls back when direct import is empty',
    () async {
      final primary = _TestPlaylistImportClient((source, id) async => null);
      final fallback = _TestPlaylistImportClient(
        (source, id) async => const (
          name: 'Fallback Playlist',
          songs: <Song>[
            Song(
              id: 'song-1',
              name: 'Fallback Track',
              artist: 'Guest Artist',
              source: MusicSource.qq,
            ),
          ],
        ),
      );
      final client = CompositePlaylistImportClient(
        primary: primary,
        fallback: fallback,
      );

      final payload = await client.importPlaylist('qq', 'playlist-42');

      expect(payload?.name, 'Fallback Playlist');
      expect(primary.calls, ['qq:playlist-42']);
      expect(fallback.calls, ['qq:playlist-42']);
    },
  );

  test('playlist import repository reports empty remote playlists', () async {
    final repository = PlaylistImportRepository.payloadLoader(
      importPlaylist: (source, id) async => null,
    );

    expect(
      () => repository.importPlaylist(source: 'kuwo', id: '24680'),
      throwsA(
        isA<PlaylistImportException>().having(
          (error) => error.code,
          'code',
          PlaylistImportErrorCode.emptyPlaylist,
        ),
      ),
    );
  });
}
