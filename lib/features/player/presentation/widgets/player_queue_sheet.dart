import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';

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

    return Positioned.fill(
      child: GestureDetector(
        onTap: onClose,
        child: ColoredBox(
          color: const Color(0x66000000),
          child: Align(
            alignment: Alignment.bottomCenter,
            child: GestureDetector(
              onTap: () {},
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
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '播放队列',
                                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Wrap(
                                  crossAxisAlignment: WrapCrossAlignment.center,
                                  spacing: 6,
                                  children: [
                                    Text(
                                      _playModeLabel(playMode),
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: Color(0xFF8B8B95),
                                      ),
                                    ),
                                    Text(
                                      '${queue.length} 首',
                                      style: const TextStyle(
                                        fontSize: 12,
                                        color: Color(0xFF8B8B95),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
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
                                style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
                              ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
                              itemCount: queue.length,
                              separatorBuilder: (_, _) => const SizedBox(height: 8),
                              itemBuilder: (context, index) {
                                final song = queue[index];
                                final isCurrent = _isCurrentSong(song);
                                return _QueueTrackTile(
                                  song: song,
                                  isCurrent: isCurrent,
                                  onTap: () => onPlaySong(song),
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  bool _isCurrentSong(Song song) {
    final activeSong = currentSong;
    return activeSong != null && activeSong.key == song.key;
  }

  String _playModeLabel(String mode) {
    return switch (mode) {
      'loop' => '单曲循环',
      'shuffle' => '随机播放',
      _ => '列表循环',
    };
  }
}

class _QueueTrackTile extends StatelessWidget {
  const _QueueTrackTile({
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
      color: isCurrent ? const Color(0x14E94B5B) : const Color(0xFFF9FAFB),
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: isCurrent ? const Color(0xFFE94B5B) : const Color(0xFFE5E7EB),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(
                  isCurrent ? Icons.graphic_eq_rounded : Icons.music_note_rounded,
                  color: isCurrent ? Colors.white : const Color(0xFF9CA3AF),
                  size: 18,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      song.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: isCurrent ? const Color(0xFFE94B5B) : const Color(0xFF111111),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            song.source.wireValue.toUpperCase(),
                            style: const TextStyle(
                              fontSize: 9,
                              fontWeight: FontWeight.w700,
                              color: Color(0xFF6B7280),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            song.artist,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 12,
                              color: Color(0xFF8B8B95),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (isCurrent)
                const Icon(
                  Icons.volume_up_rounded,
                  color: Color(0xFFE94B5B),
                  size: 18,
                ),
            ],
          ),
        ),
      ),
    );
  }
}
