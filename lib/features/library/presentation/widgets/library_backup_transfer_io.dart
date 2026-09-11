import 'dart:io';
import 'dart:typed_data';

import 'package:file_selector/file_selector.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';

import 'library_backup_transfer_types.dart';

LibraryBackupTransfer createLibraryBackupTransfer() =>
    const _IoLibraryBackupTransfer();

/// Android / iOS / 桌面端实现。
///
/// 导出：写一份到临时目录，再交给系统分享面板，由用户决定存到哪里。
/// 导入：走系统文件选择器 —— Android 上就是 SAF 的 ACTION_OPEN_DOCUMENT，
/// 因此不需要申请任何存储权限。
///
/// 两者都不需要改 AndroidManifest：里面已经有 share_plus 需要的 FileProvider
/// 声明（authority 为 `${applicationId}.fileProvider`）。
final class _IoLibraryBackupTransfer extends LibraryBackupTransfer {
  const _IoLibraryBackupTransfer();

  @override
  Future<void> downloadJsonFile({
    required String fileName,
    required String content,
    String mimeType = 'application/json',
  }) async {
    final directory = await getTemporaryDirectory();
    final file = File('${directory.path}${Platform.pathSeparator}$fileName');
    await file.writeAsString(content, flush: true);
    await SharePlus.instance.share(
      ShareParams(files: <XFile>[XFile(file.path, mimeType: mimeType)]),
    );
  }

  @override
  Future<Uint8List?> pickJsonFileBytes() async {
    const jsonGroup = XTypeGroup(
      label: 'JSON',
      extensions: <String>['json'],
      mimeTypes: <String>['application/json'],
    );
    // 用户取消时 openFile 返回 null，正好对上接口里「null 表示取消」的约定。
    final picked = await openFile(
      acceptedTypeGroups: const <XTypeGroup>[jsonGroup],
    );
    if (picked == null) {
      return null;
    }
    return picked.readAsBytes();
  }
}
