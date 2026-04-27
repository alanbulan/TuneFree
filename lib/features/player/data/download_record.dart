class DownloadRecord {
  const DownloadRecord({
    required this.songKey,
    required this.songId,
    required this.songName,
    required this.artist,
    required this.quality,
    required this.filePath,
    required this.fileName,
    required this.downloadedAtIso8601,
  });

  final String songKey;
  final String songId;
  final String songName;
  final String artist;
  final String quality;
  final String filePath;
  final String fileName;
  final String downloadedAtIso8601;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'songKey': songKey,
      'songId': songId,
      'songName': songName,
      'artist': artist,
      'quality': quality,
      'filePath': filePath,
      'fileName': fileName,
      'downloadedAtIso8601': downloadedAtIso8601,
    };
  }

  factory DownloadRecord.fromJson(Map<String, dynamic> json) {
    return DownloadRecord(
      songKey: json['songKey'] as String? ?? '',
      songId: json['songId'] as String? ?? '',
      songName: json['songName'] as String? ?? '',
      artist: json['artist'] as String? ?? '',
      quality: json['quality'] as String? ?? '',
      filePath: json['filePath'] as String? ?? '',
      fileName: json['fileName'] as String? ?? '',
      downloadedAtIso8601: json['downloadedAtIso8601'] as String? ?? '',
    );
  }
}
