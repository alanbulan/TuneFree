const defaultMobileCorsProxy = 'https://corsproxy.io/?';

String buildCorsProxyUrl(String target, {String? proxy}) {
  final normalizedProxy = _normalizeProxy(proxy);
  if (normalizedProxy.contains('{url}')) {
    return normalizedProxy.replaceAll('{url}', Uri.encodeComponent(target));
  }
  return '$normalizedProxy${Uri.encodeComponent(target)}';
}

String? normalizeMusicUrl(
  String? value, {
  bool proxyKuwoHttp = false,
  String Function()? corsProxyProvider,
}) {
  if (value == null) {
    return null;
  }

  var fixedValue = value.trim().replaceAll('&amp;', '&');
  if (fixedValue.isEmpty) {
    return null;
  }
  if (fixedValue.startsWith('//')) {
    fixedValue = 'https:$fixedValue';
  }
  if (fixedValue.startsWith('http://') &&
      (fixedValue.contains('music.126.net') ||
          fixedValue.contains('y.gtimg.cn') ||
          fixedValue.contains('qpic.cn'))) {
    fixedValue = fixedValue.replaceFirst('http://', 'https://');
  }
  if (fixedValue.contains('300x300')) {
    fixedValue = fixedValue.replaceAll('300x300', '500x500');
  }
  if (proxyKuwoHttp &&
      fixedValue.startsWith('http://') &&
      fixedValue.contains('kuwo.cn')) {
    return fixedValue;
  }
  return fixedValue;
}

Map<String, String>? musicImageRequestHeaders(String? value) {
  final host = Uri.tryParse(value ?? '')?.host.toLowerCase();
  if (host == null || !host.endsWith('music.126.net')) {
    return null;
  }
  return const <String, String>{
    'Referer': 'https://music.163.com/',
    'User-Agent':
        'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  };
}

String? musicImageProxyUrl(String? value) {
  final uri = Uri.tryParse(value?.trim() ?? '');
  final host = uri?.host.toLowerCase();
  if (uri == null || host == null || !host.endsWith('music.126.net')) {
    return null;
  }
  return 'https://images.weserv.nl/?url=${Uri.encodeComponent(uri.toString())}';
}

String jooxCoverUrl(String picId, {int size = 500}) {
  return 'https://image.joox.com/JOOXcover/0/$picId/$size';
}

String _normalizeProxy(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty || trimmed.startsWith('/')) {
    return defaultMobileCorsProxy;
  }
  return trimmed;
}
