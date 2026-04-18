import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/models/parsed_lyric.dart';
import '../../../library/application/library_controller.dart';
import '../../application/player_controller.dart';
import '../../application/player_lyrics_controller.dart';
import '../../data/player_download_service.dart';
import 'player_download_sheet.dart';
import 'player_more_sheet.dart';
import 'player_queue_sheet.dart';

class FullPlayerSheet extends ConsumerWidget {
  const FullPlayerSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(playerControllerProvider);
    final song = state.currentSong;

    if (song == null || !state.isExpanded) {
      return const SizedBox.shrink();
    }

    final durationSeconds = state.duration.inSeconds == 0
        ? 1
        : state.duration.inSeconds;
    final positionSeconds = state.position.inSeconds.clamp(0, durationSeconds);
    final playerController = ref.read(playerControllerProvider.notifier);
    final downloadService = ref.read(playerDownloadServiceProvider);
    final lyricsController = ref.watch(playerLyricsControllerProvider);
    final libraryController = ref.watch(libraryControllerProvider);
    final isFavorite = libraryController.isFavoriteSong(song);
    final lyrics = lyricsController.parseRawLyrics(song.lrc ?? '');
    final activeLyricIndex = lyricsController.findActiveIndex(
      lyrics,
      state.position.inMilliseconds / 1000,
    );

    return Positioned.fill(
      child: Material(
        key: const Key('full-player'),
        color: Colors.white,
        child: SafeArea(
          child: Stack(
            children: [
              Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
                    child: Row(
                      children: [
                        IconButton(
                          key: const Key('close-full-player'),
                          onPressed: playerController.collapse,
                          icon: const Icon(Icons.expand_more_rounded, size: 32),
                        ),
                        const Expanded(
                          child: Center(
                            child: SizedBox(
                              width: 40,
                              child: DecoratedBox(
                                decoration: BoxDecoration(
                                  color: Color(0xFFD1D5DB),
                                  borderRadius: BorderRadius.all(
                                    Radius.circular(999),
                                  ),
                                ),
                                child: SizedBox(height: 6),
                              ),
                            ),
                          ),
                        ),
                        IconButton(
                          key: const Key('player-more-button'),
                          onPressed: () => playerController.setShowMore(true),
                          icon: const Icon(Icons.more_horiz_rounded, size: 28),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(32, 8, 32, 24),
                      child: Column(
                        children: [
                          GestureDetector(
                            key: const Key('player-lyrics-toggle-area'),
                            onTap: () => playerController.setShowLyrics(
                              !state.showLyrics,
                            ),
                            child: AnimatedContainer(
                              duration: const Duration(milliseconds: 200),
                              width: double.infinity,
                              constraints: const BoxConstraints(maxWidth: 350),
                              decoration: BoxDecoration(
                                color: const Color(0xFFF3F4F6),
                                borderRadius: BorderRadius.circular(28),
                                boxShadow: const [
                                  BoxShadow(
                                    color: Color(0x14000000),
                                    blurRadius: 20,
                                    offset: Offset(0, 10),
                                  ),
                                ],
                              ),
                              child: AspectRatio(
                                aspectRatio: 1,
                                child: Center(
                                  child: state.showLyrics
                                      ? _PlayerLyricsView(
                                          lyrics: lyrics,
                                          activeLyricIndex: activeLyricIndex,
                                          onSeekToLine: (line) {
                                            playerController.seek(
                                              Duration(
                                                milliseconds: (line.time * 1000)
                                                    .round(),
                                              ),
                                            );
                                          },
                                        )
                                      : _PlayerCoverArtwork(
                                          artworkUrl: song.pic,
                                        ),
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 28),
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      song.name,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style: const TextStyle(
                                        fontSize: 28,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 6,
                                            vertical: 2,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFF9CA3AF),
                                            borderRadius: BorderRadius.circular(
                                              6,
                                            ),
                                          ),
                                          child: Text(
                                            song.source.wireValue.toUpperCase(),
                                            style: const TextStyle(
                                              fontSize: 10,
                                              color: Colors.white,
                                              fontWeight: FontWeight.w700,
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
                                              fontSize: 18,
                                              fontWeight: FontWeight.w500,
                                              color: Color(0xFFE94B5B),
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 16),
                              IconButton(
                                key: const Key('player-download-button'),
                                onPressed: () =>
                                    playerController.setShowDownload(true),
                                icon: const Icon(
                                  Icons.download_rounded,
                                  color: Color(0xFF6B7280),
                                ),
                              ),
                              IconButton(
                                key: const Key('player-like-button'),
                                onPressed: () async {
                                  await ref
                                      .read(libraryControllerProvider)
                                      .toggleFavorite(song);
                                },
                                icon: Icon(
                                  isFavorite
                                      ? Icons.favorite_rounded
                                      : Icons.favorite_border_rounded,
                                  color: isFavorite
                                      ? const Color(0xFFE94B5B)
                                      : const Color(0xFF6B7280),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                          const SizedBox(
                            height: 48,
                            child: Align(
                              alignment: Alignment.bottomCenter,
                              child: SizedBox(
                                width: double.infinity,
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    gradient: LinearGradient(
                                      colors: [
                                        Color(0x22E94B5B),
                                        Color(0x00E94B5B),
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                          Slider(
                            value: positionSeconds.toDouble(),
                            max: durationSeconds.toDouble(),
                            onChanged: (value) {
                              playerController.seek(
                                Duration(seconds: value.round()),
                              );
                            },
                          ),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                _formatSeconds(positionSeconds),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                ),
                              ),
                              Text(
                                _formatSeconds(durationSeconds),
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Color(0xFF6B7280),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 24),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              IconButton(
                                key: const Key('player-play-mode-button'),
                                onPressed: playerController.togglePlayMode,
                                icon: Icon(
                                  switch (state.playMode) {
                                    'loop' => Icons.repeat_one_rounded,
                                    'shuffle' => Icons.shuffle_rounded,
                                    _ => Icons.repeat_rounded,
                                  },
                                  color: state.playMode == 'sequence'
                                      ? const Color(0xFF9CA3AF)
                                      : const Color(0xFFE94B5B),
                                ),
                              ),
                              Row(
                                children: [
                                  IconButton(
                                    key: const Key('player-prev-button'),
                                    onPressed: () {
                                      playerController.playPrev();
                                    },
                                    icon: const Icon(
                                      Icons.skip_previous_rounded,
                                      size: 40,
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  FilledButton(
                                    key: const Key('player-primary-toggle'),
                                    onPressed: playerController.togglePlay,
                                    style: FilledButton.styleFrom(
                                      shape: const CircleBorder(),
                                      padding: const EdgeInsets.all(24),
                                      backgroundColor: const Color(0xFF111111),
                                    ),
                                    child: Icon(
                                      state.isPlaying
                                          ? Icons.pause_rounded
                                          : Icons.play_arrow_rounded,
                                      size: 32,
                                      color: Colors.white,
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  IconButton(
                                    key: const Key('player-next-button'),
                                    onPressed: () {
                                      playerController.playNext();
                                    },
                                    icon: const Icon(
                                      Icons.skip_next_rounded,
                                      size: 40,
                                    ),
                                  ),
                                ],
                              ),
                              IconButton(
                                key: const Key('player-queue-button'),
                                onPressed: () =>
                                    playerController.setShowQueue(true),
                                icon: const Icon(
                                  Icons.queue_music_rounded,
                                  color: Color(0xFF9CA3AF),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              PlayerQueueSheet(
                isOpen: state.showQueue,
                queue: state.queue,
                currentSong: state.currentSong,
                playMode: state.playMode,
                onClose: () => playerController.setShowQueue(false),
                onPlaySong: (selectedSong) async {
                  await playerController.playSong(
                    selectedSong,
                    queue: state.queue,
                    forceQuality: state.audioQuality,
                  );
                },
                onClearQueue: () {
                  playerController.clearQueue();
                },
              ),
              PlayerDownloadSheet(
                isOpen: state.showDownload,
                song: song,
                selectedQuality: state.downloadQuality,
                onDownload: (quality) async {
                  playerController.setDownloadQuality(quality);
                  return downloadService.downloadSong(song, quality);
                },
                onClose: () => playerController.setShowDownload(false),
              ),
              PlayerMoreSheet(
                isOpen: state.showMore,
                track: state.currentTrack,
                selectedQuality: state.audioQuality,
                onSelectQuality: playerController.setPlaybackQuality,
                onClose: () => playerController.setShowMore(false),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _formatSeconds(int totalSeconds) {
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '$minutes:${seconds.toString().padLeft(2, '0')}';
  }
}

class _PlayerCoverArtwork extends StatelessWidget {
  const _PlayerCoverArtwork({required this.artworkUrl});

  final String? artworkUrl;

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = artworkUrl?.trim();
    if (resolvedUrl == null || resolvedUrl.isEmpty) {
      return const _PlayerCoverPlaceholder();
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(28),
      child: ColoredBox(
        color: const Color(0xFFF3F4F6),
        child: Image.network(
          resolvedUrl,
          key: const Key('full-player-cover-artwork'),
          width: double.infinity,
          height: double.infinity,
          fit: BoxFit.cover,
          errorBuilder: (context, error, stackTrace) {
            return const Center(child: _PlayerCoverPlaceholder());
          },
        ),
      ),
    );
  }
}

class _PlayerCoverPlaceholder extends StatelessWidget {
  const _PlayerCoverPlaceholder();

  @override
  Widget build(BuildContext context) {
    return const Icon(
      Icons.music_note_rounded,
      key: Key('full-player-cover-placeholder'),
      size: 96,
      color: Color(0xFFB6B8BF),
    );
  }
}

class _PlayerLyricsView extends StatelessWidget {
  const _PlayerLyricsView({
    required this.lyrics,
    required this.activeLyricIndex,
    required this.onSeekToLine,
  });

  final List<ParsedLyric> lyrics;
  final int activeLyricIndex;
  final ValueChanged<ParsedLyric> onSeekToLine;

  @override
  Widget build(BuildContext context) {
    return ListView.separated(
      key: const Key('player-lyrics-view'),
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 28),
      physics: const BouncingScrollPhysics(),
      itemCount: lyrics.length,
      separatorBuilder: (context, index) => const SizedBox(height: 14),
      itemBuilder: (context, index) {
        final line = lyrics[index];
        final isActive = index == activeLyricIndex;
        final lineKey = Key(
          'player-lyrics-line-${isActive ? 'active' : 'inactive'}-$index',
        );
        final translationKey = Key(
          'player-lyrics-translation-${isActive ? 'active' : 'inactive'}-$index',
        );

        return GestureDetector(
          onTap: () => onSeekToLine(line),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                line.text,
                key: lineKey,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: isActive ? 24 : 20,
                  fontWeight: FontWeight.w700,
                  color: isActive
                      ? const Color(0xFF111111)
                      : const Color(0xFF8B8B95),
                  height: 1.4,
                ),
              ),
              if (line.translation case final translation?) ...[
                const SizedBox(height: 6),
                Text(
                  translation,
                  key: translationKey,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: isActive ? 16 : 14,
                    fontWeight: FontWeight.w500,
                    color: isActive
                        ? const Color(0xFF4B5563)
                        : const Color(0xFFB6B8BF),
                    height: 1.4,
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
