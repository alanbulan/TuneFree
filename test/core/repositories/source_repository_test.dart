import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/data/top_list_repository.dart';
import 'package:tunefree/features/library/data/playlist_import_repository.dart';
import 'package:tunefree/features/search/data/search_repository.dart';

void main() {
  test('aggregate search interleaves source results and tolerates failures', () async {
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
        Song(
          id: 'q1',
          name: 'QQ歌曲',
          artist: '歌手B',
          source: MusicSource.qq,
        ),
      ],
      kuwoSearch: (_, page) async => throw Exception('offline'),
    );

    final result = await repository.searchAggregate('test', page: 1);

    expect(result.map((song) => song.key).toList(), ['netease:n1', 'qq:q1']);
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

  test('playlist import repository returns imported songs with stable fallback name', () async {
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

    final result = await repository.importPlaylist(source: 'qq', id: 'playlist-42');

    expect(result, isNotNull);
    expect(result!.$1, 'playlist-42');
    expect(result.$2.map((song) => song.key).toList(), ['migu:song-1']);
    expect(calls, ['qq:playlist-42']);
  });
}
