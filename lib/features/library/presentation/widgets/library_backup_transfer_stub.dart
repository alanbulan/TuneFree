import 'dart:typed_data';

import 'library_backup_transfer_types.dart';

LibraryBackupTransfer createLibraryBackupTransfer() => const _UnsupportedLibraryBackupTransfer();

final class _UnsupportedLibraryBackupTransfer extends LibraryBackupTransfer {
  const _UnsupportedLibraryBackupTransfer();

  @override
  Future<void> downloadJsonFile({
    required String fileName,
    required String content,
    String mimeType = 'application/json',
  }) async {
    throw UnsupportedError('library backup file export is only available on web');
  }

  @override
  Future<Uint8List?> pickJsonFileBytes() async {
    throw UnsupportedError('library backup file import is only available on web');
  }
}
