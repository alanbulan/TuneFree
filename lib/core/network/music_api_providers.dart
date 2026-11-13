import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/library/application/library_controller.dart';
import 'gd_studio_api_client.dart';
import 'music_api_controller.dart';
import 'source_http_client.dart';
import 'tune_free_http_client.dart';

final musicApiHttpClientProvider = Provider<TuneFreeHttpClient>((ref) {
  final client = TuneFreeHttpClient();
  ref.onDispose(() => client.dio.close(force: true));
  return client;
});

final musicSourceHttpClientProvider = Provider<SourceHttpClient>((ref) {
  final library = ref.watch(libraryControllerProvider.notifier);
  return SourceHttpClient(
    httpClient: ref.watch(musicApiHttpClientProvider),
    corsProxyProvider: () => library.state.corsProxy,
  );
});

final gdStudioApiClientProvider = Provider<GdStudioApiClient>((ref) {
  final controller = ref.watch(musicApiControllerProvider.notifier);
  return GdStudioApiClient(
    httpClient: ref.watch(musicSourceHttpClientProvider),
    settingsLoader: () => controller.ready,
  );
});
