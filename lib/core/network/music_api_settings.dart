const defaultMusicApiBase = 'https://music-api.gdstudio.xyz/api.php';
const defaultPlaylistApiBase = 'https://tunehub.sayqz.com/api';

enum MusicApiRequestMode {
  gdSignedPost,
  compatibleGet;

  String get label => switch (this) {
    gdSignedPost => 'GD 签名 POST',
    compatibleGet => '兼容 GET',
  };
}

final class MusicApiSettings {
  const MusicApiSettings({
    this.musicApiBase = defaultMusicApiBase,
    this.playlistApiBase = defaultPlaylistApiBase,
    this.requestMode = MusicApiRequestMode.gdSignedPost,
  });

  factory MusicApiSettings.fromInput({
    required String musicApiBase,
    required String playlistApiBase,
    required MusicApiRequestMode requestMode,
  }) {
    return MusicApiSettings(
      musicApiBase: normalizeMusicApiUrl(musicApiBase, defaultMusicApiBase),
      playlistApiBase: normalizeMusicApiUrl(
        playlistApiBase,
        defaultPlaylistApiBase,
        trimTrailingSlash: true,
      ),
      requestMode: requestMode,
    );
  }

  factory MusicApiSettings.fromJson(Map<String, dynamic> json) {
    String readUrl(String key, String fallback, {bool trimSlash = false}) {
      final value = json[key];
      if (value is! String || validateMusicApiUrl(value) != null) {
        return fallback;
      }
      return normalizeMusicApiUrl(
        value,
        fallback,
        trimTrailingSlash: trimSlash,
      );
    }

    return MusicApiSettings(
      musicApiBase: readUrl('musicApiBase', defaultMusicApiBase),
      playlistApiBase: readUrl(
        'playlistApiBase',
        defaultPlaylistApiBase,
        trimSlash: true,
      ),
      requestMode: json['requestMode'] == MusicApiRequestMode.compatibleGet.name
          ? MusicApiRequestMode.compatibleGet
          : MusicApiRequestMode.gdSignedPost,
    );
  }

  final String musicApiBase;
  final String playlistApiBase;
  final MusicApiRequestMode requestMode;

  bool get usesCustomMusicApi => musicApiBase != defaultMusicApiBase;

  Map<String, dynamic> toJson() => <String, dynamic>{
    'musicApiBase': musicApiBase,
    'playlistApiBase': playlistApiBase,
    'requestMode': requestMode.name,
  };

  @override
  bool operator ==(Object other) =>
      other is MusicApiSettings &&
      musicApiBase == other.musicApiBase &&
      playlistApiBase == other.playlistApiBase &&
      requestMode == other.requestMode;

  @override
  int get hashCode => Object.hash(musicApiBase, playlistApiBase, requestMode);
}

String? validateMusicApiUrl(String value) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    return null;
  }
  final uri = Uri.tryParse(trimmed);
  if (uri == null ||
      (uri.scheme != 'https' && uri.scheme != 'http') ||
      uri.host.isEmpty ||
      RegExp(r'\s').hasMatch(trimmed)) {
    return '请输入完整的 HTTPS 或 HTTP 地址';
  }
  if (uri.hasFragment) {
    return '接口地址不能包含 # 片段';
  }
  if (uri.userInfo.isNotEmpty) {
    return '请使用服务商提供的接口地址，不要在域名前填写账号密码';
  }
  if (uri.port <= 0 || uri.port > 65535) {
    return '端口号应在 1–65535 之间';
  }
  return null;
}

String normalizeMusicApiUrl(
  String value,
  String fallback, {
  bool trimTrailingSlash = false,
}) {
  final trimmed = value.trim();
  if (trimmed.isEmpty) {
    return fallback;
  }
  final error = validateMusicApiUrl(trimmed);
  if (error != null) {
    throw FormatException(error);
  }
  final uri = Uri.parse(trimmed);
  return trimTrailingSlash
      ? uri.replace(path: uri.path.replaceFirst(RegExp(r'/+$'), '')).toString()
      : uri.toString();
}
