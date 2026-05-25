import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/home/application/home_providers.dart';
import 'package:tunefree/features/home/data/top_list_repository.dart';
import 'package:tunefree/features/library/application/library_controller.dart';
import 'package:tunefree/features/library/data/library_storage.dart';
import 'package:tunefree/features/player/data/download_library_repository.dart';
import 'package:tunefree/features/player/data/download_record.dart';
import 'package:tunefree/features/player/data/download_record_store.dart';
import 'package:tunefree/features/search/application/search_providers.dart';
import 'package:tunefree/features/search/data/search_repository.dart';

final class _EmptyDownloadRecordStore implements DownloadRecordStore {
  @override
  Future<DownloadRecord?> load({
    required String songKey,
    required String quality,
  }) async {
    return null;
  }

  @override
  Future<List<DownloadRecord>> listAll() async {
    return const <DownloadRecord>[];
  }

  @override
  Future<List<DownloadRecord>> listBySongKey(String songKey) async {
    return const <DownloadRecord>[];
  }

  @override
  Future<void> remove({
    required String songKey,
    required String quality,
  }) async {}

  @override
  Future<void> save(DownloadRecord record) async {}
}

LibraryController _libraryController() {
  return LibraryController(
    storage: LegacyLibraryStorage(),
    downloadLibraryRepository: DownloadLibraryRepository(
      recordStore: _EmptyDownloadRecordStore(),
      fileExists: (_) async => false,
      deleteFile: (_) async {},
    ),
  );
}

void main() {
  test('Home provider wires the real top-list repository by default', () {
    final libraryController = _libraryController();
    final container = ProviderContainer(
      overrides: [
        libraryControllerProvider.overrideWith((ref) => libraryController),
      ],
    );
    addTearDown(container.dispose);

    expect(
      container.read(remoteTopListRepositoryProvider),
      isA<TopListRepository>(),
    );
  });

  test('Search provider wires the real search repository by default', () {
    final libraryController = _libraryController();
    final container = ProviderContainer(
      overrides: [
        libraryControllerProvider.overrideWith((ref) => libraryController),
      ],
    );
    addTearDown(container.dispose);

    expect(
      container.read(remoteSearchRepositoryProvider),
      isA<SearchRepository>(),
    );
  });
}
