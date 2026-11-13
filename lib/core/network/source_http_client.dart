import 'package:dio/dio.dart';

import 'music_url_normalizer.dart';
import 'source_data_parsing.dart';
import 'tune_free_http_client.dart';

final class SourceHttpClient {
  SourceHttpClient({
    required TuneFreeHttpClient httpClient,
    this._corsProxyProvider,
    this._timeout = const Duration(seconds: 12),
  }) : _httpClient = httpClient,
       _dio = httpClient.dio;

  final TuneFreeHttpClient _httpClient;
  final Dio _dio;
  final String Function()? _corsProxyProvider;
  final Duration _timeout;

  Future<dynamic> getJson(
    Uri uri, {
    bool proxyFirst = false,
    bool includeProxyFallback = true,
    bool allowSingleQuoteJson = false,
    Map<String, String>? headers,
  }) async {
    final text = await getText(
      uri,
      proxyFirst: proxyFirst,
      includeProxyFallback: includeProxyFallback,
      headers: headers,
    );
    return parseJsonLike(text, allowSingleQuoteJson: allowSingleQuoteJson);
  }

  Future<String> getText(
    Uri uri, {
    bool proxyFirst = false,
    bool includeProxyFallback = true,
    Map<String, String>? headers,
  }) {
    return _requestText(
      uri,
      proxyFirst: proxyFirst,
      includeProxyFallback: includeProxyFallback,
      request: (requestUri) =>
          _dio.getUri<String>(requestUri, options: _options(headers: headers)),
    );
  }

  Future<dynamic> postFormJson(
    Uri uri, {
    required Map<String, String> data,
  }) async {
    final text = await _requestText(
      uri,
      proxyFirst: false,
      includeProxyFallback: false,
      request: (requestUri) => _dio.postUri<String>(
        requestUri,
        data: data,
        options: _options(
          headers: <String, String>{
            Headers.contentTypeHeader: Headers.formUrlEncodedContentType,
          },
        ),
      ),
    );
    return parseJsonLike(text);
  }

  Future<dynamic> postJson(
    Uri uri, {
    required Object data,
    Map<String, String>? headers,
  }) async {
    final text = await _requestText(
      uri,
      proxyFirst: false,
      includeProxyFallback: false,
      request: (requestUri) => _dio.postUri<String>(
        requestUri,
        data: data,
        options: _options(
          headers: <String, String>{
            Headers.contentTypeHeader: Headers.jsonContentType,
            ...?headers,
          },
        ),
      ),
    );
    return parseJsonLike(text);
  }

  Future<String> _requestText(
    Uri uri, {
    required bool proxyFirst,
    bool includeProxyFallback = true,
    required Future<Response<String>> Function(Uri uri) request,
  }) async {
    Object? lastError;
    for (final requestUri in _candidateUris(
      uri,
      proxyFirst: proxyFirst,
      includeProxyFallback: includeProxyFallback,
    )) {
      try {
        // 等待用户处理系统授权弹窗不计入 HTTP 超时。
        await _httpClient.ensureNetworkAccess(requestUri);
        final response = await request(requestUri).timeout(_timeout);
        final data = response.data;
        if (data != null) {
          return data;
        }
        final dynamic rawData = response.data;
        return rawData?.toString() ?? '';
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError != null) {
      throw lastError;
    }
    throw StateError('Source request failed');
  }

  Iterable<Uri> _candidateUris(
    Uri uri, {
    required bool proxyFirst,
    required bool includeProxyFallback,
  }) sync* {
    final proxyUri = includeProxyFallback ? _proxyUri(uri) : null;
    if (proxyFirst && proxyUri != null) {
      yield proxyUri;
    }
    yield uri;
    if (!proxyFirst && proxyUri != null) {
      yield proxyUri;
    }
  }

  Uri? _proxyUri(Uri uri) {
    final proxied = buildCorsProxyUrl(
      uri.toString(),
      proxy: _corsProxyProvider?.call(),
    );
    return Uri.tryParse(proxied);
  }

  Options _options({Map<String, String>? headers}) {
    return Options(responseType: ResponseType.plain, headers: headers);
  }
}
