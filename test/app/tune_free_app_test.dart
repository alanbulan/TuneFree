import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/app.dart';
import 'package:tunefree/core/models/music_source.dart';
import 'package:tunefree/core/models/song.dart';
import 'package:tunefree/core/models/top_list.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/home/data/remote_top_list_repository.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';

final class _FakeTopListRepository implements RemoteTopListRepository {
  const _FakeTopListRepository();

  @override
  Future<List<TopList>> getTopLists(String source) async {
    return const <TopList>[TopList(id: '1', name: '飙升榜')];
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
  testWidgets('renders the Flutter shell with three tabs', (tester) async {
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
        child: const TuneFreeApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('shell-bottom-nav')), findsOneWidget);
    expect(find.text('首页'), findsOneWidget);
    expect(find.text('搜索'), findsOneWidget);
    expect(find.text('我的'), findsOneWidget);
  });
}
