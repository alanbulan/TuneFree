import 'package:dio/dio.dart';

import 'music_url_normalizer.dart';
import 'source_data_parsing.dart';
import 'tune_free_http_client.dart';

final class SourceHttpClient {
  SourceHttpClient({
    required TuneFreeHttpClient httpClient,
    String Function()? corsProxyProvider,
    Duration timeout = const Duration(seconds: 12),
  }) : _dio = httpClient.dio,
       _corsProxyProvider = corsProxyProvider,
       _timeout = timeout;

  final Dio _dio;
  final String Function()? _corsProxyProvider;
  final Duration _timeout;

  Future<dynamic> getJson(
    Uri uri, {
    bool proxyFirst = false,
    bool allowSingleQuoteJson = false,
    Map<String, String>? headers,
  }) async {
    final text = await getText(uri, proxyFirst: proxyFirst, headers: headers);
    return parseJsonLike(text, allowSingleQuoteJson: allowSingleQuoteJson);
  }

  Future<String> getText(
    Uri uri, {
    bool proxyFirst = false,
    Map<String, String>? headers,
  }) {
    return _requestText(
      uri,
      proxyFirst: proxyFirst,
      request: (requestUri) =>
          _dio.getUri<String>(requestUri, options: _options(headers: headers)),
    );
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
    throw StateError('Source request failed for $uri: $lastError');
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
