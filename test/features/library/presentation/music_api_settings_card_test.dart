import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tunefree/core/network/music_api_connection_tester.dart';
import 'package:tunefree/core/network/music_api_controller.dart';
import 'package:tunefree/core/network/music_api_settings.dart';
import 'package:tunefree/core/network/music_api_store.dart';
import 'package:tunefree/core/network/tune_free_http_client.dart';
import 'package:tunefree/app/theme/app_theme.dart';
import 'package:tunefree/features/library/presentation/widgets/music_api_settings_card.dart';

final class _MemoryStore implements MusicApiStore {
  MusicApiSettings value = const MusicApiSettings();
  bool fail = false;

  @override
  Future<MusicApiSettings> load() async => value;

  @override
  Future<void> save(MusicApiSettings settings) async {
    if (fail) {
      throw StateError('unavailable');
    }
    value = settings;
  }
}

Future<void> _pump(
  WidgetTester tester,
  ProviderContainer container, {
  double width = 360,
  Brightness brightness = Brightness.light,
  double textScale = 1,
}) async {
  tester.view.physicalSize = Size(width, 1000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        theme: buildTuneFreeTheme(
          brightness: brightness,
          accent: const Color(0xFFFA233B),
        ),
        home: MediaQuery(
          data: MediaQueryData(textScaler: TextScaler.linear(textScale)),
          child: const Scaffold(
            body: SingleChildScrollView(
              padding: EdgeInsets.all(16),
              child: MusicApiSettingsCard(),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  final finder = find.byKey(Key(key));
  await tester.ensureVisible(finder);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'settings form validates, saves, reloads and resets request mode and URLs',
    (tester) async {
      final store = _MemoryStore();
      final container = ProviderContainer(
        overrides: [musicApiStoreProvider.overrideWithValue(store)],
      );
      addTearDown(container.dispose);
      await _pump(tester, container);
      await tester.enterText(
        find.byKey(const Key('music-api-url-field')),
        'invalid-url',
      );
      await _tap(tester, 'music-api-save-button');
      expect(find.text('请输入完整的 HTTPS 或 HTTP 地址'), findsOneWidget);
      expect(store.value, const MusicApiSettings());
      await tester.enterText(
        find.byKey(const Key('music-api-url-field')),
        'https://music.example/api.php',
      );
      await tester.enterText(
        find.byKey(const Key('playlist-api-url-field')),
        'https://playlist.example/api/',
      );
      expect(find.text('未保存'), findsOneWidget);
      await _tap(tester, 'music-api-mode-compatibleGet');
      await _tap(tester, 'music-api-save-button');
      expect(store.value.musicApiBase, 'https://music.example/api.php');
      expect(store.value.playlistApiBase, 'https://playlist.example/api');
      expect(store.value.requestMode, MusicApiRequestMode.compatibleGet);
      expect(find.text('音源设置已保存，即刻生效'), findsOneWidget);
      expect(find.text('未保存'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
      await _pump(tester, container);
      expect(
        tester
            .widget<TextFormField>(find.byKey(const Key('music-api-url-field')))
            .controller!
            .text,
        'https://music.example/api.php',
      );
      await _tap(tester, 'music-api-reset-button');
      expect(store.value, const MusicApiSettings());
      expect(
        tester
            .widget<TextFormField>(find.byKey(const Key('music-api-url-field')))
            .controller!
            .text,
        isEmpty,
      );
      expect(find.text('GD 签名 POST'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed persistence preserves both active settings and form draft',
    (tester) async {
      final store = _MemoryStore()..fail = true;
      final container = ProviderContainer(
        overrides: [musicApiStoreProvider.overrideWithValue(store)],
      );
      addTearDown(container.dispose);
      await _pump(tester, container);
      await tester.enterText(
        find.byKey(const Key('music-api-url-field')),
        'https://draft.example/api.php',
      );
      await _tap(tester, 'music-api-save-button');
      expect(find.text('保存失败，请重试'), findsOneWidget);
      expect(
        container.read(musicApiControllerProvider).settings,
        const MusicApiSettings(),
      );
      expect(
        tester
            .widget<TextFormField>(find.byKey(const Key('music-api-url-field')))
            .controller!
            .text,
        'https://draft.example/api.php',
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('connection detection uses the draft without saving it', (
    tester,
  ) async {
    final store = _MemoryStore();
    final dio = Dio();
    Uri? testedUri;
    dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) {
          testedUri = options.uri;
          handler.resolve(
            Response(
              requestOptions: options,
              data: '[{"id":"1","name":"Lemon"}]',
            ),
          );
        },
      ),
    );
    final container = ProviderContainer(
      overrides: [
        musicApiStoreProvider.overrideWithValue(store),
        musicApiConnectionTesterProvider.overrideWithValue(
          MusicApiConnectionTester(httpClient: TuneFreeHttpClient(dio: dio)),
        ),
      ],
    );
    addTearDown(container.dispose);
    await _pump(tester, container);
    await tester.enterText(
      find.byKey(const Key('music-api-url-field')),
      'https://draft.example/api.php',
    );
    await _tap(tester, 'music-api-mode-compatibleGet');
    await _tap(tester, 'music-api-test-button');
    expect(testedUri!.host, 'draft.example');
    expect(find.text('音乐 API 连接成功'), findsOneWidget);
    expect(store.value, const MusicApiSettings());
    expect(tester.takeException(), isNull);
  });

  testWidgets('narrow dark layout supports large text and URL error feedback', (
    tester,
  ) async {
    final container = ProviderContainer(
      overrides: [musicApiStoreProvider.overrideWithValue(_MemoryStore())],
    );
    addTearDown(container.dispose);
    await _pump(
      tester,
      container,
      width: 320,
      brightness: Brightness.dark,
      textScale: 1.3,
    );
    await tester.enterText(
      find.byKey(const Key('music-api-url-field')),
      'invalid',
    );
    await _tap(tester, 'music-api-save-button');
    expect(find.text('请输入完整的 HTTPS 或 HTTP 地址'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
