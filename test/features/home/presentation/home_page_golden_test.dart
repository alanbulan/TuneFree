import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';
import 'package:tunefree/features/home/presentation/home_page.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';

final class _FakeTopListRepository implements RemoteTopListRepository {
  const _FakeTopListRepository();

  @override
  Future<List<TopList>> getTopLists(String source) async {
    return const <TopList>[
      TopList(id: '1', name: '飙升榜', updateFrequency: '每日更新'),
      TopList(id: '2', name: '新歌榜', updateFrequency: '每日更新'),
    ];
  }

  @override
  Future<List<Song>> getTopListDetail(String source, String id) async {
    return const <Song>[
      Song(
        id: 'n1',
        name: '海与你',
        artist: '马也_Crabbit',
        source: MusicSource.netease,
      ),
    ];
  }
}

void main() {
  testWidgets('home page keeps the legacy greeting and ranking hierarchy', (
    tester,
  ) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          remoteTopListRepositoryProvider.overrideWithValue(
            const _FakeTopListRepository(),
          ),
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(
            NoopMediaSessionAdapter(),
          ),
        ],
        child: const MaterialApp(home: HomePage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('排行榜'), findsOneWidget);
    expect(find.text('飙升榜 · 热歌'), findsOneWidget);
    expect(find.text('网易云'), findsAtLeastNWidgets(1));
  });
}
