// ignore_for_file: deprecated_member_use, avoid_web_libraries_in_flutter

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'dart:html' as html;

import 'library_backup_transfer_types.dart';

LibraryBackupTransfer createLibraryBackupTransfer() => const _WebLibraryBackupTransfer();

final class _WebLibraryBackupTransfer extends LibraryBackupTransfer {
  const _WebLibraryBackupTransfer();

  @override
  Future<void> downloadJsonFile({
    required String fileName,
    required String content,
    String mimeType = 'application/json',
  }) async {
    final bytes = utf8.encode(content);
    final blob = html.Blob(<Object>[bytes], mimeType);
    final url = html.Url.createObjectUrlFromBlob(blob);
    final anchor = html.AnchorElement(href: url)
      ..download = fileName
      ..style.display = 'none';
    html.document.body?.append(anchor);
    anchor.click();
    anchor.remove();
    html.Url.revokeObjectUrl(url);
  }

  @override
  Future<Uint8List?> pickJsonFileBytes() {
    final completer = Completer<Uint8List?>();
    final input = html.FileUploadInputElement()
      ..accept = '.json,application/json'
      ..style.display = 'none';

    void completeIfNeeded(Uint8List? value) {
      if (!completer.isCompleted) {
        completer.complete(value);
      }
      input.remove();
    }

    input.onChange.first.then((_) {
      final file = input.files?.first;
      if (file == null) {
        completeIfNeeded(null);
        return;
      }

      final reader = html.FileReader();
      reader.onLoad.first.then((_) {
        final result = reader.result;
        if (result is ByteBuffer) {
          completeIfNeeded(Uint8List.view(result));
          return;
        }
        if (result is Uint8List) {
          completeIfNeeded(result);
          return;
        }
        completeIfNeeded(null);
      });
      reader.onError.first.then((_) => completeIfNeeded(null));
      reader.readAsArrayBuffer(file);
    });

    html.document.body?.append(input);
    input.click();
    return completer.future;
  }
}
