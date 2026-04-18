enum AudioQuality { k128, k320, flac, flac24bit }

extension AudioQualityWire on AudioQuality {
  String get wireValue => switch (this) {
        AudioQuality.k128 => '128k',
        AudioQuality.k320 => '320k',
        AudioQuality.flac => 'flac',
        AudioQuality.flac24bit => 'flac24bit',
      };

  String get shortLabel => switch (this) {
        AudioQuality.k128 => '标准',
        AudioQuality.k320 => '高品',
        AudioQuality.flac => '无损',
        AudioQuality.flac24bit => 'Hi-Res',
      };

  String get downloadLabel => switch (this) {
        AudioQuality.k128 => '标准音质',
        AudioQuality.k320 => '高品质',
        AudioQuality.flac => '无损音质',
        AudioQuality.flac24bit => 'Hi-Res',
      };

  String get downloadDescription => switch (this) {
        AudioQuality.k128 => '128kbps / MP3',
        AudioQuality.k320 => '320kbps / MP3',
        AudioQuality.flac => 'FLAC',
        AudioQuality.flac24bit => '24bit FLAC',
      };

  static AudioQuality fromWire(String value) => switch (value) {
        '128k' => AudioQuality.k128,
        '320k' => AudioQuality.k320,
        'flac' => AudioQuality.flac,
        'flac24bit' => AudioQuality.flac24bit,
        _ => AudioQuality.k320,
      };
}
