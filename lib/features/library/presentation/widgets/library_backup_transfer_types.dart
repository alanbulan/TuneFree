import 'dart:typed_data';

abstract class LibraryBackupTransfer {
  const LibraryBackupTransfer();

  Future<void> downloadJsonFile({
    required String fileName,
    required String content,
    String mimeType = 'application/json',
  });

  Future<Uint8List?> pickJsonFileBytes();
}
