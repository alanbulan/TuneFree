import 'dart:convert';

Map<String, dynamic>? readMap(dynamic value) {
  if (value is Map<String, dynamic>) {
    return value;
  }
  if (value is Map) {
    return Map<String, dynamic>.from(value);
  }
  return null;
}

List<dynamic> readList(dynamic value) {
  if (value is List) {
    return value;
  }
  return const <dynamic>[];
}

List<Map<String, dynamic>> readMapList(dynamic value) {
  return readList(
    value,
  ).map(readMap).whereType<Map<String, dynamic>>().toList(growable: false);
}

String? readString(dynamic value) {
  if (value == null) {
    return null;
  }
  if (value is String) {
    final trimmed = cleanText(value);
    return trimmed.isEmpty ? null : trimmed;
  }
  return value.toString();
}

String cleanText(String value) {
  return value.replaceAll('&nbsp;', ' ').trim();
}

dynamic readPath(dynamic value, List<Object> path) {
  dynamic current = value;
  for (final segment in path) {
    if (segment is String) {
      final map = readMap(current);
      if (map == null) {
        return null;
      }
      current = map[segment];
    } else if (segment is int) {
      final list = readList(current);
      if (segment < 0 || segment >= list.length) {
        return null;
      }
      current = list[segment];
    }
  }
  return current;
}

String joinNamedEntries(dynamic value) {
  if (value is List) {
    final names = value
        .map((entry) {
          if (entry is String) {
            return cleanText(entry);
          }
          return readString(readMap(entry)?['name']);
        })
        .whereType<String>()
        .where((name) => name.isNotEmpty)
        .toList(growable: false);
    return names.join(', ');
  }
  return readString(value) ?? '';
}

dynamic parseJsonLike(String value, {bool allowSingleQuoteJson = false}) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    return null;
  }

  try {
    return jsonDecode(trimmed);
  } catch (_) {
    final match = RegExp(
      r'^\s*[\w.]+\s*\((.*)\)\s*;?\s*$',
      dotAll: true,
    ).firstMatch(trimmed);
    if (match != null) {
      try {
        return jsonDecode(match.group(1)!);
      } catch (_) {}
    }
    if (allowSingleQuoteJson) {
      return jsonDecode(trimmed.replaceAll("'", '"'));
    }
    rethrow;
  }
}
