// 默认分支是原生实现（Android/iOS/桌面），web 走 dart:html。
// 保持「默认 = 原生」的形状，与 web 实现自身的 dart:html 依赖相匹配。
import 'library_backup_transfer_io.dart'
    if (dart.library.html) 'library_backup_transfer_web.dart';
import 'library_backup_transfer_types.dart';

export 'library_backup_transfer_types.dart';

final LibraryBackupTransfer defaultLibraryBackupTransfer =
    createLibraryBackupTransfer();
