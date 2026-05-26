import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';
import '../../../../shared/widgets/music_network_image.dart';
import '../../../../shared/music_source_display.dart';
import 'player_bottom_sheet_transition.dart';

class PlayerQueueSheet extends StatelessWidget {
  const PlayerQueueSheet({
    super.key,
    required this.isOpen,
    required this.queue,
    required this.currentSong,
    required this.playMode,
    required this.onClose,
    required this.onPlaySong,
    required this.onClearQueue,
  });

  final bool isOpen;
  final List<Song> queue;
  final Song? currentSong;
  final String playMode;
  final VoidCallback onClose;
  final ValueChanged<Song> onPlaySong;
  final VoidCallback onClearQueue;

  @override
  Widget build(BuildContext context) {
    if (!isOpen) {
      return const SizedBox.shrink();
    }

    return PlayerBottomSheetTransition(
      onClose: onClose,
      child: Container(
        key: const Key('player-queue-sheet'),
        height: MediaQuery.of(context).size.height * 0.6,
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 12, 12),
              child: Row(
                children: [
                  Text(
                    '播放队列',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '${queue.length} 首 · ${_playModeLabel(playMode)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF8B8B95),
                      ),
                    ),
                  ),
                  IconButton(
                    key: const Key('player-queue-clear-button'),
                    onPressed: queue.isEmpty ? null : onClearQueue,
                    icon: const Icon(Icons.delete_outline_rounded),
                    tooltip: '清空队列',
                  ),
                  IconButton(
                    key: const Key('player-queue-close-button'),
                    onPressed: onClose,
                    icon: const Icon(Icons.close_rounded),
                    tooltip: '关闭',
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: queue.isEmpty
                  ? const Center(
                      child: Text(
                        '队列为空',
                        style: TextStyle(
                          fontSize: 14,
                          color: Color(0xFF9CA3AF),
                        ),
                      ),
                    )
                  : _QueueTrackList(
                      queue: queue,
                      currentSong: currentSong,
                      onPlaySong: onPlaySong,
                    ),
            ),
          ],
        ),
      ),
    );
  }

  String _playModeLabel(String mode) {
    return switch (mode) {
      'loop' => '单曲循环',
      'shuffle' => '随机播放',
      _ => '列表循环',
    };
  }
}

class _QueueTrackList extends StatefulWidget {
  const _QueueTrackList({
    required this.queue,
    required this.currentSong,
    required this.onPlaySong,
  });

  final List<Song> queue;
  final Song? currentSong;
  final ValueChanged<Song> onPlaySong;

  @override
  State<_QueueTrackList> createState() => _QueueTrackListState();
}

class _QueueTrackListState extends State<_QueueTrackList> {
  static const _estimatedRowExtent = 89.0;

  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scheduleCurrentSongScroll();
  }

  @override
  void didUpdateWidget(covariant _QueueTrackList oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.currentSong?.key != widget.currentSong?.key ||
        oldWidget.queue.length != widget.queue.length) {
      _scheduleCurrentSongScroll();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scheduleCurrentSongScroll() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients) {
        return;
      }
      final activeSong = widget.currentSong;
      if (activeSong == null) {
        return;
      }
      final currentIndex = widget.queue.indexWhere(
        (song) => song.key == activeSong.key,
      );
      if (currentIndex < 0) {
        return;
      }

      final position = _scrollController.position;
      final targetOffset =
          currentIndex * _estimatedRowExtent -
          position.viewportDimension / 2 +
          _estimatedRowExtent / 2;
      final clampedOffset = targetOffset.clamp(
        position.minScrollExtent,
        position.maxScrollExtent,
      );
      _scrollController.animateTo(
        clampedOffset.toDouble(),
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 20),
      itemCount: widget.queue.length,
      separatorBuilder: (_, _) => const Divider(
        height: 1,
        indent: 82,
        endIndent: 12,
        color: Color(0xFFE5E7EB),
      ),
      itemBuilder: (context, index) {
        final song = widget.queue[index];
        final isCurrent = _isCurrentSong(song);
        return _QueueTrackTile(
          key: Key('player-queue-track-${song.key}'),
          song: song,
          isCurrent: isCurrent,
          onTap: () => widget.onPlaySong(song),
        );
      },
    );
  }

  bool _isCurrentSong(Song song) {
    final activeSong = widget.currentSong;
    return activeSong != null && activeSong.key == song.key;
  }
}

class _QueueTrackTile extends StatelessWidget {
  const _QueueTrackTile({
    super.key,
    required this.song,
    required this.isCurrent,
    required this.onTap,
  });

  final Song song;
  final bool isCurrent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: isCurrent ? const Color(0x0FE94B5B) : Colors.transparent,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
          child: Row(
            children: [
              _QueueArtwork(song: song, isCurrent: isCurrent),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            song.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: isCurrent
                                  ? const Color(0xFFE94B5B)
                                  : const Color(0xFF111111),
                            ),
                          ),
                        ),
                        if (isCurrent) ...[
                          const SizedBox(width: 8),
                          const Text(
                            '播放中',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFFE94B5B),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _artistText(song),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: Color(0xFF6B7280),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        _SourceBadge(source: song.source.wireValue),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _albumText(song),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF9CA3AF),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                isCurrent ? Icons.graphic_eq_rounded : Icons.play_arrow_rounded,
                color: isCurrent
                    ? const Color(0xFFE94B5B)
                    : const Color(0xFF9CA3AF),
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _artistText(Song song) {
    final artist = song.artist.trim();
    return artist.isEmpty ? '未知歌手' : artist;
  }

  String _albumText(Song song) {
    final album = song.album.trim();
    return album.isEmpty ? '专辑：未收录' : '专辑：$album';
  }
}

class _QueueArtwork extends StatelessWidget {
  const _QueueArtwork({required this.song, required this.isCurrent});

  final Song song;
  final bool isCurrent;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 56,
      height: 56,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isCurrent ? const Color(0xFFE94B5B) : const Color(0xFFE5E7EB),
        ),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(13),
        child: _artworkImage(),
      ),
    );
  }

  Widget _artworkImage() {
    final artwork = song.pic?.trim();
    if (artwork == null || artwork.isEmpty) {
      return const _ArtworkPlaceholder();
    }
    return MusicNetworkImage(
      artwork,
      key: Key('player-queue-artwork-${song.key}'),
      fit: BoxFit.cover,
      errorBuilder: (_, _, _) => const _ArtworkPlaceholder(),
    );
  }
}

class _ArtworkPlaceholder extends StatelessWidget {
  const _ArtworkPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: Color(0xFFF3F4F6),
      child: Icon(Icons.music_note_rounded, color: Color(0xFF9CA3AF), size: 22),
    );
  }
}

class _SourceBadge extends StatelessWidget {
  const _SourceBadge({required this.source});

  final String source;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        musicSourceBadgeLabel(source),
        style: const TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w700,
          color: Color(0xFF6B7280),
        ),
      ),
    );
  }
}
