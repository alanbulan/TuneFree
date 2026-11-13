import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3 把 ChangeNotifierProvider 移出了主流出口，只在 legacy.dart 里提供。
import 'package:flutter_riverpod/legacy.dart';

import '../../../core/network/music_api_controller.dart';
import '../../../core/network/music_api_providers.dart';
import '../../../core/source_clients/gd_studio_client.dart';
import '../../../core/source_clients/kuwo_client.dart';
import '../../../core/source_clients/netease_client.dart';
import '../../../core/source_clients/qq_client.dart';
import '../../library/application/library_controller.dart';
import '../data/remote_search_repository.dart';
import '../data/search_repository.dart';
import 'search_controller.dart';

final _neteaseClientProvider = Provider<NeteaseClient>((ref) {
  return ReactNeteaseClient(
    httpClient: ref.watch(musicSourceHttpClientProvider),
  );
});

final _qqClientProvider = Provider<QqClient>((ref) {
  return ReactQqClient(httpClient: ref.watch(musicSourceHttpClientProvider));
});

final _kuwoClientProvider = Provider<KuwoClient>((ref) {
  final libraryController = ref.watch(libraryControllerProvider.notifier);
  return ReactKuwoClient(
    httpClient: ref.watch(musicSourceHttpClientProvider),
    corsProxyProvider: () => libraryController.state.corsProxy,
  );
});

final _gdStudioClientProvider = Provider<GdStudioClient>((ref) {
  return ReactGdStudioClient(
    httpClient: ref.watch(musicSourceHttpClientProvider),
    apiClient: ref.watch(gdStudioApiClientProvider),
  );
});

final remoteSearchRepositoryProvider = Provider<RemoteSearchRepository>((ref) {
  final gdStudioClient = ref.watch(_gdStudioClientProvider);
  final controller = ref.watch(musicApiControllerProvider.notifier);
  SearchFunction withCustomApi(String source, SearchFunction nativeSearch) {
    return (keyword, page) async {
      final settings = await controller.ready;
      return settings.usesCustomMusicApi
          ? gdStudioClient.search(keyword, source, page)
          : nativeSearch(keyword, page);
    };
  }

  return SearchRepository(
    neteaseSearch: withCustomApi(
      'netease',
      ref.watch(_neteaseClientProvider).search,
    ),
    qqSearch: withCustomApi('qq', ref.watch(_qqClientProvider).search),
    kuwoSearch: withCustomApi('kuwo', ref.watch(_kuwoClientProvider).search),
    jooxSearch: (keyword, page) => gdStudioClient.search(keyword, 'joox', page),
    bilibiliSearch: (keyword, page) =>
        gdStudioClient.search(keyword, 'bilibili', page),
  );
});

final searchControllerProvider = ChangeNotifierProvider<SearchController>((
  ref,
) {
  return SearchController(
    repository: ref.watch(remoteSearchRepositoryProvider),
  );
});
