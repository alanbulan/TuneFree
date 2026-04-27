import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/remote_search_repository.dart';
import 'search_controller.dart';

final remoteSearchRepositoryProvider = Provider<RemoteSearchRepository>((ref) {
  return const LegacySearchRepository();
});

final searchControllerProvider = ChangeNotifierProvider<SearchController>((ref) {
  return SearchController(repository: ref.watch(remoteSearchRepositoryProvider));
});
