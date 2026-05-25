import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/source_http_client.dart';
import '../../../core/network/tune_free_http_client.dart';
import '../../../core/source_clients/kuwo_client.dart';
import '../../../core/source_clients/netease_client.dart';
import '../../../core/source_clients/qq_client.dart';
import '../../library/application/library_controller.dart';
import '../data/remote_top_list_repository.dart';
import '../data/top_list_repository.dart';
import 'home_controller.dart';

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

final remoteTopListRepositoryProvider = Provider<RemoteTopListRepository>((
  ref,
) {
  return TopListRepository(
    neteaseClient: ref.watch(_neteaseClientProvider),
    qqClient: ref.watch(_qqClientProvider),
    kuwoClient: ref.watch(_kuwoClientProvider),
  );
});

final homeControllerProvider = ChangeNotifierProvider<HomeController>((ref) {
  final controller = HomeController(
    repository: ref.watch(remoteTopListRepositoryProvider),
  );
  unawaited(controller.loadSource('netease'));
  return controller;
});
