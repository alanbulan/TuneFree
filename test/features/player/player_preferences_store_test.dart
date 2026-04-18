import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/features/player/data/player_preferences_store.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('loadCurrentSong logs malformed persisted payloads', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      'player.currentSong': '{bad json',
    });

    final messages = <String>[];
    final originalDebugPrint = debugPrint;
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) {
        messages.add(message);
      }
    };
    addTearDown(() {
      debugPrint = originalDebugPrint;
      SharedPreferences.setMockInitialValues(<String, Object>{});
    });

    final store = SharedPreferencesPlayerPreferencesStore();

    expect(await store.loadCurrentSong(), isNull);
    expect(
      messages.any(
        (message) =>
            message.contains('player.currentSong') && message.contains('failed to decode'),
      ),
      isTrue,
    );
  });
}
