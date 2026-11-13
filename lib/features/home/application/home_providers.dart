import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
// Riverpod 3 把 ChangeNotifierProvider 移出了主流出口，只在 legacy.dart 里提供。
import 'package:flutter_riverpod/legacy.dart';

import '../../../core/network/music_api_providers.dart';
import '../../../core/source_clients/kuwo_client.dart';
import '../../../core/source_clients/netease_client.dart';
import '../../../core/source_clients/qq_client.dart';
import '../../library/application/library_controller.dart';
import '../data/remote_top_list_repository.dart';
import '../data/top_list_repository.dart';
import 'home_controller.dart';

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
