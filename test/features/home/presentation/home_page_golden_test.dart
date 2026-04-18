import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/home/presentation/home_page.dart';
import 'package:tunefree/features/player/application/just_audio_player_engine.dart';
import 'package:tunefree/features/player/application/media_session_adapter.dart';
import 'package:tunefree/features/player/application/player_controller.dart';

void main() {
  testWidgets('home page keeps the legacy greeting and ranking hierarchy', (tester) async {
    final engine = JustAudioPlayerEngine.test();
    addTearDown(engine.dispose);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          playerEngineProvider.overrideWithValue(engine),
          mediaSessionAdapterProvider.overrideWithValue(NoopMediaSessionAdapter()),
        ],
        child: const MaterialApp(home: HomePage()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('排行榜'), findsOneWidget);
    expect(find.text('榜单热歌'), findsOneWidget);
    expect(find.text('NETEASE'), findsAtLeastNWidgets(1));
  });
}
