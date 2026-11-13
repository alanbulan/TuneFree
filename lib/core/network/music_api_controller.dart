import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';

import 'music_api_settings.dart';
import 'music_api_store.dart';

final musicApiStoreProvider = Provider<MusicApiStore>((ref) {
  return SharedPreferencesMusicApiStore();
});

final musicApiControllerProvider = ChangeNotifierProvider<MusicApiController>((
  ref,
) {
  final controller = MusicApiController(
    store: ref.watch(musicApiStoreProvider),
  );
  unawaited(controller.load());
  return controller;
});

final class MusicApiController extends ChangeNotifier {
  MusicApiController({required this._store});

  final MusicApiStore _store;
  MusicApiSettings _settings = const MusicApiSettings();
  Future<void>? _loading;
  bool _isLoaded = false;
  bool _disposed = false;

  MusicApiSettings get settings => _settings;
  bool get isLoaded => _isLoaded;

  Future<void> load() => _loading ??= _load();

  // 请求先等待本地配置，避免启动时误用默认地址；每次读取返回最新保存值。
  Future<MusicApiSettings> get ready async {
    await load();
    return _settings;
  }

  Future<void> _load() async {
    try {
      _settings = await _store.load();
    } catch (_) {
      _settings = const MusicApiSettings();
    }
    _isLoaded = true;
    if (!_disposed) {
      notifyListeners();
    }
  }

  Future<void> save(MusicApiSettings settings) async {
    await load();
    // 落盘成功才切换当前接口，失败时界面可以保留用户的草稿并重试。
    await _store.save(settings);
    if (_disposed) {
      return;
    }
    _settings = settings;
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
