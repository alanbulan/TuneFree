import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

final class LocalNetworkPermissionDenied implements Exception {
  const LocalNetworkPermissionDenied();

  @override
  String toString() => '请允许 TuneFree 访问本地网络后重试';
}

/// Android 17 起，局域网连接需要运行时授权。由原生端判断目标地址。
final class LocalNetworkAccess {
  LocalNetworkAccess({
    bool Function()? isAndroid,
    this._channel = const MethodChannel('tunefree/local_network'),
  }) : _isAndroid = isAndroid ?? (() => !kIsWeb && Platform.isAndroid);

  static final instance = LocalNetworkAccess();

  final bool Function() _isAndroid;
  final MethodChannel _channel;
  final Map<String, Future<void>> _pending = {};

  Future<void> ensureAccess(Uri uri) {
    if (!_isAndroid() || uri.host.isEmpty) {
      return Future<void>.value();
    }
    final host = uri.host;
    return _pending[host] ??= _request(host).whenComplete(() {
      _pending.remove(host);
    });
  }

  Future<void> _request(String host) async {
    final allowed = await _channel.invokeMethod<bool>(
      'ensureAccess',
      <String, String>{'host': host},
    );
    if (allowed != true) {
      throw const LocalNetworkPermissionDenied();
    }
  }
}
