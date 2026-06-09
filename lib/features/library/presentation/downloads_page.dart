import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/audio_quality.dart';
import '../../../core/models/music_source.dart';
import '../../../core/models/song.dart';
import '../../../shared/widgets/music_network_image.dart';
import '../../../shared/music_source_display.dart';
import '../../../shared/theme/tune_free_spacing.dart';
import '../../../shared/widgets/tune_free_badge.dart';
import '../../../shared/widgets/tune_free_card.dart';
import '../../player/application/player_controller.dart';
import '../../player/data/download_library_repository.dart';
import '../application/library_controller.dart';

class LibraryDownloadsPage extends ConsumerStatefulWidget {
  const LibraryDownloadsPage({super.key});

  @override
  ConsumerState<LibraryDownloadsPage> createState() =>
      _LibraryDownloadsPageState();
}

class _LibraryDownloadsPageState extends ConsumerState<LibraryDownloadsPage> {
  final Set<String> _selectedDownloadKeys = <String>{};
  bool _isEditing = false;
  bool _isDeleting = false;

  @override
  void initState() {
    super.initState();
    unawaited(ref.read(libraryControllerProvider).refreshDownloads());
  }

  Future<void> _refreshDownloads() {
    return ref.read(libraryControllerProvider).refreshDownloads();
  }

  Future<void> _handlePlay(
    DownloadedTrackItem item,
    List<DownloadedTrackItem> downloads,
  ) async {
    if (_isEditing) {
      _toggleSelection(item);
      return;
    }

    final queue = downloads.map(_songFromDownload).toList(growable: false);
    final song = _songFromDownload(item);
    await ref
        .read(playerControllerProvider.notifier)
        .playSong(
          song,
          queue: queue,
          forceQuality: _qualityFromWire(item.quality),
        );
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('已加入播放队列并播放 ${item.songName}')));
  }

  Future<void> _handleDeleteSelected() async {
    if (_selectedDownloadKeys.isEmpty || _isDeleting) {
      return;
    }

    final controller = ref.read(libraryControllerProvider);
    final selectedDownloads = controller.state.downloads
        .where((item) => _selectedDownloadKeys.contains(_downloadKey(item)))
        .toList(growable: false);
    if (selectedDownloads.isEmpty) {
      return;
    }

    setState(() {
      _isDeleting = true;
    });

    try {
      for (final item in selectedDownloads) {
        await controller.deleteDownload(item);
      }
      if (!mounted) {
        return;
      }
      setState(() {
        _isDeleting = false;
        _isEditing = false;
        _selectedDownloadKeys.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('已删除 ${selectedDownloads.length} 首歌曲')),
      );
    } catch (_) {
      if (!mounted) {
        return;
      }
      setState(() {
        _isDeleting = false;
      });
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('删除失败，请稍后重试')));
    }
  }

  void _toggleEditMode() {
    setState(() {
      _isEditing = !_isEditing;
      _selectedDownloadKeys.clear();
    });
  }

  void _toggleSelection(DownloadedTrackItem item) {
    final key = _downloadKey(item);
    setState(() {
      if (!_selectedDownloadKeys.add(key)) {
        _selectedDownloadKeys.remove(key);
      }
    });
  }

  void _selectAll(List<DownloadedTrackItem> downloads) {
    setState(() {
      final allKeys = downloads.map(_downloadKey).toSet();
      if (_selectedDownloadKeys.length == downloads.length) {
        _selectedDownloadKeys.clear();
      } else {
        _selectedDownloadKeys
          ..clear()
          ..addAll(allKeys);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(libraryControllerProvider).state;
    final downloads = state.downloads;
    final hasDownloads = downloads.isNotEmpty;

    return Scaffold(
      key: const Key('library-downloads-page'),
      backgroundColor: const Color(0xFFF5F7FA),
      appBar: AppBar(
        title: Text(_isEditing ? '选择下载歌曲' : '下载管理'),
        backgroundColor: const Color(0xFFF5F7FA),
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        actions: [
          if (hasDownloads)
            TextButton(
              key: const Key('library-downloads-edit-button'),
              onPressed: _isDeleting ? null : _toggleEditMode,
              child: Text(_isEditing ? '取消' : '编辑'),
            ),
          if (_isEditing)
            IconButton(
              key: const Key('library-downloads-delete-selected-button'),
              onPressed: _selectedDownloadKeys.isEmpty || _isDeleting
                  ? null
                  : _handleDeleteSelected,
              icon: _isDeleting
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.delete_outline_rounded),
              tooltip: '删除选中歌曲',
            )
          else
            IconButton(
              key: const Key('library-downloads-refresh-button'),
              onPressed: _refreshDownloads,
              icon: const Icon(Icons.refresh_rounded),
              tooltip: '刷新下载列表',
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshDownloads,
        child: hasDownloads
            ? ListView.separated(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  TuneFreeSpacing.page,
                  10,
                  TuneFreeSpacing.page,
                  TuneFreeSpacing.shellContentBottomPadding,
                ),
                itemCount: downloads.length + (_isEditing ? 1 : 0),
                separatorBuilder: (_, _) => const SizedBox(height: 8),
                itemBuilder: (context, index) {
                  if (_isEditing && index == 0) {
                    return _DownloadsSelectionToolbar(
                      selectedCount: _selectedDownloadKeys.length,
                      totalCount: downloads.length,
                      onSelectAll: () => _selectAll(downloads),
                    );
                  }
                  final download = downloads[index - (_isEditing ? 1 : 0)];
                  return _DownloadedTrackTile(
                    item: download,
                    isEditing: _isEditing,
                    isSelected: _selectedDownloadKeys.contains(
                      _downloadKey(download),
                    ),
                    onTap: () => _handlePlay(download, downloads),
                    onLongPress: () {
                      if (!_isEditing) {
                        setState(() {
                          _isEditing = true;
                          _selectedDownloadKeys.add(_downloadKey(download));
                        });
                      }
                    },
                    onSelectionChanged: () => _toggleSelection(download),
                  );
                },
              )
            : ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(
                  TuneFreeSpacing.page,
                  56,
                  TuneFreeSpacing.page,
                  TuneFreeSpacing.shellContentBottomPadding,
                ),
                children: const [_DownloadsEmptyState()],
              ),
      ),
    );
  }
}

class _DownloadedTrackTile extends StatelessWidget {
  const _DownloadedTrackTile({
    required this.item,
    required this.isEditing,
    required this.isSelected,
    required this.onTap,
    required this.onLongPress,
    required this.onSelectionChanged,
  });

  final DownloadedTrackItem item;
  final bool isEditing;
  final bool isSelected;
  final VoidCallback onTap;
  final VoidCallback onLongPress;
  final VoidCallback onSelectionChanged;

  @override
  Widget build(BuildContext context) {
    final source = _sourceFromSongKey(item.songKey);
    final colors = musicSourceBadgeColors(source);

    return TuneFreeCard(
      padding: EdgeInsets.zero,
      child: InkWell(
        key: Key('downloaded-track-${item.songKey}-${item.quality}'),
        borderRadius: BorderRadius.circular(TuneFreeSpacing.cardRadius),
        onTap: onTap,
        onLongPress: onLongPress,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                child: isEditing
                    ? Checkbox(
                        key: Key(
                          'select-downloaded-track-${item.songKey}-${item.quality}',
                        ),
                        value: isSelected,
                        onChanged: (_) => onSelectionChanged(),
                      )
                    : _DownloadArtwork(item: item),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          flex: 3,
                          child: Text(
                            item.songName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Flexible(
                          flex: 2,
                          child: Text(
                            item.artist.isEmpty ? '未知歌手' : item.artist,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF6B7280),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        TuneFreeBadge(
                          text: musicSourceBadgeLabel(source),
                          background: colors.background,
                          foreground: colors.foreground,
                        ),
                        TuneFreeBadge(
                          text: _qualityBadgeLabel(item.quality),
                          background: const Color(0xFFEFF6FF),
                          foreground: const Color(0xFF2563EB),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      '${_qualityDetailLabel(item.quality)} · ${_downloadedAtLabel(item.downloadedAt)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: Color(0xFF9CA3AF),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              if (!isEditing)
                const Icon(
                  Icons.play_circle_fill_rounded,
                  color: Color(0xFFE94B5B),
                  size: 26,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DownloadArtwork extends StatelessWidget {
  _DownloadArtwork({required this.item})
    : super(
        key: ValueKey<String>(
          'downloaded-track-artwork-${item.songKey}-${item.quality}',
        ),
      );

  final DownloadedTrackItem item;

  @override
  Widget build(BuildContext context) {
    final artworkUrl = item.artworkUrl?.trim();
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        width: 38,
        height: 38,
        child: artworkUrl == null || artworkUrl.isEmpty
            ? _DownloadArtworkFallback(item: item)
            : MusicNetworkImage(
                artworkUrl,
                key: Key(
                  'downloaded-track-artwork-image-${item.songKey}-${item.quality}',
                ),
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    _DownloadArtworkFallback(item: item),
              ),
      ),
    );
  }
}

class _DownloadArtworkFallback extends StatelessWidget {
  const _DownloadArtworkFallback({required this.item});

  final DownloadedTrackItem item;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: Key(
        'downloaded-track-artwork-fallback-${item.songKey}-${item.quality}',
      ),
      color: const Color(0xFFFFEEF1),
      child: const Icon(Icons.music_note_rounded, color: Color(0xFFE94B5B)),
    );
  }
}

class _DownloadsSelectionToolbar extends StatelessWidget {
  const _DownloadsSelectionToolbar({
    required this.selectedCount,
    required this.totalCount,
    required this.onSelectAll,
  });

  final int selectedCount;
  final int totalCount;
  final VoidCallback onSelectAll;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('library-downloads-selection-toolbar'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              '已选择 $selectedCount / $totalCount 首',
              style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
            ),
          ),
          TextButton(
            key: const Key('library-downloads-select-all-button'),
            onPressed: onSelectAll,
            child: Text(selectedCount == totalCount ? '取消全选' : '全选'),
          ),
        ],
      ),
    );
  }
}

class _DownloadsEmptyState extends StatelessWidget {
  const _DownloadsEmptyState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: const [
          Icon(Icons.download_done_rounded, size: 42, color: Color(0xFFCBD5E1)),
          SizedBox(height: 14),
          Text(
            '暂无下载歌曲',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: Color(0xFF6B7280),
            ),
          ),
          SizedBox(height: 6),
          Text(
            '下载完成后会在这里显示完整歌曲信息。',
            style: TextStyle(fontSize: 13, color: Color(0xFF9CA3AF)),
          ),
        ],
      ),
    );
  }
}

String _downloadKey(DownloadedTrackItem item) =>
    '${item.songKey}::${item.quality}';

Song _songFromDownload(DownloadedTrackItem item) {
  final source = _sourceFromSongKey(item.songKey);
  return Song(
    id: _songIdFromSongKey(item.songKey),
    name: item.songName,
    artist: item.artist,
    pic: item.artworkUrl,
    source: MusicSource(source),
    url: Uri.file(item.filePath).toString(),
    audioQualities: <AudioQuality>[_qualityFromWire(item.quality)],
  );
}

AudioQuality _qualityFromWire(String quality) {
  return AudioQualityWire.fromWire(quality);
}

String _sourceFromSongKey(String songKey) {
  final separator = songKey.indexOf(':');
  if (separator <= 0) {
    return MusicSource.unknown.wireValue;
  }
  return songKey.substring(0, separator);
}

String _songIdFromSongKey(String songKey) {
  final separator = songKey.indexOf(':');
  if (separator < 0 || separator == songKey.length - 1) {
    return songKey;
  }
  return songKey.substring(separator + 1);
}

String _qualityBadgeLabel(String quality) {
  return switch (quality) {
    '128k' => '标准',
    '320k' => '高品',
    'flac' => '无损',
    'flac24bit' => 'Hi-Res',
    _ => quality.toUpperCase(),
  };
}

String _qualityDetailLabel(String quality) {
  return switch (quality) {
    '128k' => '标准音质 · 128kbps / MP3',
    '320k' => '高品质 · 320kbps / MP3',
    'flac' => '无损音质 · FLAC',
    'flac24bit' => 'Hi-Res · 24bit FLAC',
    _ => quality.toUpperCase(),
  };
}

String _downloadedAtLabel(DateTime value) {
  final local = value.toLocal();
  String twoDigits(int input) => input.toString().padLeft(2, '0');
  return '${local.year}-${twoDigits(local.month)}-${twoDigits(local.day)} '
      '${twoDigits(local.hour)}:${twoDigits(local.minute)}';
}
