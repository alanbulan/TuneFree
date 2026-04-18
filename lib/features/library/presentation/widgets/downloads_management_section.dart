import 'package:flutter/material.dart';

import '../../../../shared/widgets/tune_free_card.dart';
import '../../../player/data/download_library_repository.dart';
import 'settings_card.dart';

class DownloadsManagementSection extends StatelessWidget {
  const DownloadsManagementSection({
    super.key,
    required this.downloads,
    required this.onDelete,
  });

  final List<DownloadedTrackItem> downloads;
  final Future<void> Function(DownloadedTrackItem item) onDelete;

  @override
  Widget build(BuildContext context) {
    return SettingsCard(
      title: '已下载歌曲',
      icon: Icons.download_done_rounded,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (downloads.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 36),
              child: Center(
                child: Text(
                  '暂无已下载歌曲',
                  style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
                ),
              ),
            )
          else
            ...downloads.map(
              (download) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TuneFreeCard(
                  child: Row(
                    children: [
                      const Icon(
                        Icons.music_note_rounded,
                        color: Color(0xFFB6B8BF),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              download.songName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 15,
                                fontWeight: FontWeight.w500,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              download.artist,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: Color(0xFF8B8B95),
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        key: Key(
                          'delete-downloaded-track-${download.songKey}-${download.quality}',
                        ),
                        onPressed: () async => onDelete(download),
                        icon: const Icon(
                          Icons.delete_outline_rounded,
                          color: Color(0xFFE94B5B),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
