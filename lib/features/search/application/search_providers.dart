import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3 把 ChangeNotifierProvider 移出了主流出口，只在 legacy.dart 里提供。
import 'package:flutter_riverpod/legacy.dart';

import '../../../core/network/source_http_client.dart';
import '../../../core/network/tune_free_http_client.dart';
import '../../../core/source_clients/gd_studio_client.dart';
import '../../../core/source_clients/kuwo_client.dart';
import '../../../core/source_clients/netease_client.dart';
import '../../../core/source_clients/qq_client.dart';
import '../../library/application/library_controller.dart';
import '../data/remote_search_repository.dart';
import '../data/search_repository.dart';
import 'search_controller.dart';

final _sourceHttpClientProvider = Provider<SourceHttpClient>((ref) {
  final libraryController = ref.watch(libraryControllerProvider);
  return SourceHttpClient(
    httpClient: TuneFreeHttpClient(),
    corsProxyProvider: () => libraryController.state.corsProxy,
  );
});

final _neteaseClientProvider = Provider<NeteaseClient>((ref) {
  return ReactNeteaseClient(httpClient: ref.watch(_sourceHttpClientProvider));
});

final _qqClientProvider = Provider<QqClient>((ref) {
  return ReactQqClient(httpClient: ref.watch(_sourceHttpClientProvider));
});

final _kuwoClientProvider = Provider<KuwoClient>((ref) {
  final libraryController = ref.watch(libraryControllerProvider);
  return ReactKuwoClient(
    httpClient: ref.watch(_sourceHttpClientProvider),
    corsProxyProvider: () => libraryController.state.corsProxy,
  );
});

final _gdStudioClientProvider = Provider<GdStudioClient>((ref) {
  return ReactGdStudioClient(httpClient: ref.watch(_sourceHttpClientProvider));
});

final remoteSearchRepositoryProvider = Provider<RemoteSearchRepository>((ref) {
  final gdStudioClient = ref.watch(_gdStudioClientProvider);
  return SearchRepository(
    neteaseSearch: ref.watch(_neteaseClientProvider).search,
    qqSearch: ref.watch(_qqClientProvider).search,
    kuwoSearch: ref.watch(_kuwoClientProvider).search,
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
