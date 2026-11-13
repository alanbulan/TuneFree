import 'package:dio/dio.dart';

import 'local_network_access.dart';

final class TuneFreeHttpClient {
  TuneFreeHttpClient({Dio? dio, LocalNetworkAccess? localNetworkAccess})
    : dio =
          dio ??
          Dio(
            BaseOptions(
              connectTimeout: const Duration(seconds: 12),
              sendTimeout: const Duration(seconds: 12),
              receiveTimeout: const Duration(seconds: 12),
            ),
          ),
      _localNetworkAccess = localNetworkAccess ?? LocalNetworkAccess.instance {
    this.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          try {
            await ensureNetworkAccess(options.uri);
            handler.next(options);
          } catch (error) {
            handler.reject(
              DioException(
                requestOptions: options,
                error: error,
                message: error.toString(),
              ),
            );
          }
        },
      ),
    );
  }

  final Dio dio;
  final LocalNetworkAccess _localNetworkAccess;

  Future<void> ensureNetworkAccess(Uri uri) =>
      _localNetworkAccess.ensureAccess(uri);
}
