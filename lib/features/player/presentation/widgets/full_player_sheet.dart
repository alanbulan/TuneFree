import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/models/parsed_lyric.dart';
import '../../../../core/network/music_url_normalizer.dart';
import '../../../../shared/music_source_display.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import '../../../library/application/library_controller.dart';
import '../../application/audio_spectrum_analyzer.dart';
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

    if (song == null) {
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
      child: IgnorePointer(
        ignoring: !state.isExpanded,
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 360),
          reverseDuration: const Duration(milliseconds: 280),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          transitionBuilder: (child, animation) {
            final offset = Tween<Offset>(
              begin: const Offset(0, 1),
              end: Offset.zero,
            ).animate(animation);
            return FadeTransition(
              opacity: animation,
              child: SlideTransition(position: offset, child: child),
            );
          },
          child: state.isExpanded
              ? PopScope(
                  key: const ValueKey<String>('full-player-open'),
                  canPop: false,
                  onPopInvokedWithResult: (didPop, result) {
                    if (!didPop) {
                      playerController.collapse();
                    }
                  },
                  child: Material(
                    key: const Key('full-player'),
                    color: TuneFreePalette.surface,
                    child: Stack(
                      children: [
                        _AmbientArtworkBackground(artworkUrl: song.pic),
                        SafeArea(
                          child: Column(
                            children: [
                              _FullPlayerHeader(
                                onClose: playerController.collapse,
                                onMore: () =>
                                    playerController.setShowMore(true),
                              ),
                              Expanded(
                                child: AnimatedPadding(
                                  duration: const Duration(milliseconds: 260),
                                  curve: Curves.easeOutCubic,
                                  padding: EdgeInsets.symmetric(
                                    horizontal: state.showLyrics ? 16 : 32,
                                  ),
                                  child: GestureDetector(
                                    key: const Key('player-lyrics-toggle-area'),
                                    behavior: HitTestBehavior.opaque,
                                    onTap: () => playerController.setShowLyrics(
                                      !state.showLyrics,
                                    ),
                                    child: AnimatedSwitcher(
                                      duration: const Duration(
                                        milliseconds: 260,
                                      ),
                                      child: state.showLyrics
                                          ? _PlayerLyricsView(
                                              key: const Key(
                                                'player-lyrics-panel',
                                              ),
                                              lyrics: lyrics,
                                              activeLyricIndex:
                                                  activeLyricIndex,
                                              onSeekToLine: (line) {
                                                playerController.seek(
                                                  Duration(
                                                    milliseconds:
                                                        (line.time * 1000)
                                                            .round(),
                                                  ),
                                                );
                                              },
                                            )
                                          : _PlayerCoverPanel(
                                              key: const Key(
                                                'player-cover-panel',
                                              ),
                                              artworkUrl: song.pic,
                                              isPlaying: state.isPlaying,
                                            ),
                                    ),
                                  ),
                                ),
                              ),
                              Padding(
                                padding: const EdgeInsets.fromLTRB(
                                  32,
                                  12,
                                  32,
                                  16,
                                ),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    _SongInfoRow(
                                      title: song.name,
                                      artist: song.artist,
                                      source: song.source.wireValue,
                                      isFavorite: isFavorite,
                                      onDownload: () => playerController
                                          .setShowDownload(true),
                                      onFavorite: () async {
                                        await ref
                                            .read(libraryControllerProvider)
                                            .toggleFavorite(song);
                                      },
                                    ),
                                    const SizedBox(height: 18),
                                    _PlayerVisualizer(
                                      isPlaying: state.isPlaying,
                                    ),
                                    const SizedBox(height: 8),
                                    Slider(
                                      value: positionSeconds.toDouble(),
                                      max: durationSeconds.toDouble(),
                                      activeColor: TuneFreePalette.textPrimary,
                                      inactiveColor: const Color(0xFFD1D5DB),
                                      onChanged: (value) {
                                        playerController.seek(
                                          Duration(seconds: value.round()),
                                        );
                                      },
                                    ),
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.spaceBetween,
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
                                    const SizedBox(height: 18),
                                    _PlaybackControls(
                                      playMode: state.playMode,
                                      isPlaying: state.isPlaying,
                                      isLoading: state.isLoading,
                                      onTogglePlayMode:
                                          playerController.togglePlayMode,
                                      onPrevious: playerController.playPrev,
                                      onTogglePlay: playerController.togglePlay,
                                      onNext: playerController.playNext,
                                      onQueue: () =>
                                          playerController.setShowQueue(true),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        _PlaybackStatusNotice(
                          isLoading: state.isLoading,
                          message: state.playbackNotice,
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
                          onClearQueue: playerController.clearQueue,
                        ),
                        PlayerDownloadSheet(
                          isOpen: state.showDownload,
                          song: song,
                          selectedQuality: state.downloadQuality,
                          onDownload: (quality) async {
                            playerController.setDownloadQuality(quality);
                            final result = await downloadService.downloadSong(
                              song,
                              quality,
                            );
                            await ref
                                .read(libraryControllerProvider)
                                .refreshDownloads();
                            return result;
                          },
                          onClose: () =>
                              playerController.setShowDownload(false),
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
                )
              : const SizedBox.shrink(
                  key: ValueKey<String>('full-player-closed'),
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

class _AmbientArtworkBackground extends StatelessWidget {
  const _AmbientArtworkBackground({required this.artworkUrl});

  final String? artworkUrl;

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = artworkUrl?.trim();

    return Stack(
      fit: StackFit.expand,
      children: [
        AnimatedSwitcher(
          duration: const Duration(milliseconds: 360),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          child: resolvedUrl == null || resolvedUrl.isEmpty
              ? const SizedBox.shrink(key: ValueKey<String>('ambient-empty'))
              : Opacity(
                  key: ValueKey<String>('ambient-$resolvedUrl'),
                  opacity: 0.4,
                  child: ImageFiltered(
                    imageFilter: ImageFilter.blur(sigmaX: 34, sigmaY: 34),
                    child: Transform.scale(
                      scale: 1.45,
                      child: Image.network(
                        resolvedUrl,
                        fit: BoxFit.cover,
                        headers: musicImageRequestHeaders(resolvedUrl),
                        errorBuilder: (context, error, stackTrace) =>
                            const SizedBox.shrink(),
                      ),
                    ),
                  ),
                ),
        ),
        ColoredBox(color: TuneFreePalette.surface.withValues(alpha: 0.62)),
      ],
    );
  }
}

class _FullPlayerHeader extends StatefulWidget {
  const _FullPlayerHeader({required this.onClose, required this.onMore});

  final VoidCallback onClose;
  final VoidCallback onMore;

  @override
  State<_FullPlayerHeader> createState() => _FullPlayerHeaderState();
}

class _FullPlayerHeaderState extends State<_FullPlayerHeader> {
  double _dragOffset = 0;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onVerticalDragUpdate: (details) {
        _dragOffset = math.max(0, _dragOffset + (details.primaryDelta ?? 0));
      },
      onVerticalDragEnd: (details) {
        final shouldClose =
            _dragOffset > 150 || (details.primaryVelocity ?? 0) > 300;
        _dragOffset = 0;
        if (shouldClose) {
          widget.onClose();
        }
      },
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
        child: Row(
          children: [
            IconButton(
              key: const Key('close-full-player'),
              onPressed: widget.onClose,
              icon: const Icon(
                Icons.expand_more_rounded,
                size: 32,
                color: Color(0xFF6B7280),
              ),
            ),
            const Expanded(
              child: Center(
                child: SizedBox(
                  width: 40,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Color(0xCCD1D5DB),
                      borderRadius: BorderRadius.all(Radius.circular(999)),
                    ),
                    child: SizedBox(height: 6),
                  ),
                ),
              ),
            ),
            IconButton(
              key: const Key('player-more-button'),
              onPressed: widget.onMore,
              icon: const Icon(
                Icons.more_horiz_rounded,
                size: 28,
                color: Color(0xFF6B7280),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlaybackStatusNotice extends StatelessWidget {
  const _PlaybackStatusNotice({required this.isLoading, required this.message});

  final bool isLoading;
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Positioned(
      left: 32,
      right: 32,
      bottom: 156,
      child: IgnorePointer(
        child: AnimatedSwitcher(
          duration: const Duration(milliseconds: 180),
          reverseDuration: const Duration(milliseconds: 140),
          switchInCurve: Curves.easeOutCubic,
          switchOutCurve: Curves.easeInCubic,
          transitionBuilder: (child, animation) {
            final offset = Tween<Offset>(
              begin: const Offset(0, 0.2),
              end: Offset.zero,
            ).animate(animation);
            return FadeTransition(
              opacity: animation,
              child: SlideTransition(position: offset, child: child),
            );
          },
          child: isLoading || message != null
              ? Center(
                  key: Key(
                    isLoading
                        ? 'player-loading-notice'
                        : 'player-playback-notice',
                  ),
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.72),
                      borderRadius: BorderRadius.circular(999),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.14),
                          blurRadius: 24,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 9,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            isLoading
                                ? Icons.graphic_eq_rounded
                                : Icons.info_outline_rounded,
                            size: 16,
                            color: Colors.white,
                          ),
                          const SizedBox(width: 8),
                          Text(
                            isLoading ? '正在加载播放源…' : message!,
                            style: const TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color: Colors.white,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              : const SizedBox.shrink(key: Key('player-loading-notice-hidden')),
        ),
      ),
    );
  }
}

class _PlayerCoverPanel extends StatelessWidget {
  const _PlayerCoverPanel({
    super.key,
    required this.artworkUrl,
    required this.isPlaying,
  });

  final String? artworkUrl;
  final bool isPlaying;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: AnimatedScale(
        duration: const Duration(milliseconds: 700),
        curve: Curves.easeInOut,
        scale: isPlaying ? 1 : 0.95,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 350),
          child: AspectRatio(
            aspectRatio: 1,
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Positioned.fill(
                  child: AnimatedScale(
                    duration: const Duration(milliseconds: 720),
                    curve: Curves.easeOutCubic,
                    scale: isPlaying ? 1.06 : 1.02,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 720),
                      curve: Curves.easeOutCubic,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(24),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(
                              alpha: isPlaying ? 0.16 : 0.08,
                            ),
                            blurRadius: isPlaying ? 54 : 34,
                            spreadRadius: isPlaying ? 1 : -8,
                            offset: const Offset(0, 18),
                          ),
                          BoxShadow(
                            color: const Color(
                              0xFF64748B,
                            ).withValues(alpha: isPlaying ? 0.12 : 0.06),
                            blurRadius: isPlaying ? 70 : 44,
                            spreadRadius: -12,
                            offset: const Offset(0, 22),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
                Positioned.fill(
                  child: Container(
                    decoration: BoxDecoration(
                      color: const Color(0xFFF3F4F6),
                      borderRadius: BorderRadius.circular(18),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.15),
                          blurRadius: 60,
                          spreadRadius: -12,
                          offset: const Offset(0, 25),
                        ),
                      ],
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: _PlayerCoverArtwork(artworkUrl: artworkUrl),
                  ),
                ),
                Positioned.fill(
                  child: IgnorePointer(
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 720),
                      curve: Curves.easeOutCubic,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(18),
                        border: Border.all(
                          color: Colors.white.withValues(
                            alpha: isPlaying ? 0.62 : 0.38,
                          ),
                          width: isPlaying ? 1.8 : 1.2,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PlayerCoverArtwork extends StatelessWidget {
  const _PlayerCoverArtwork({required this.artworkUrl});

  final String? artworkUrl;

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = artworkUrl?.trim();
    return AnimatedSwitcher(
      duration: const Duration(milliseconds: 300),
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      transitionBuilder: (child, animation) {
        return FadeTransition(
          opacity: animation,
          child: ScaleTransition(
            scale: Tween<double>(begin: 0.985, end: 1).animate(animation),
            child: child,
          ),
        );
      },
      child: resolvedUrl == null || resolvedUrl.isEmpty
          ? const SizedBox.expand(
              key: ValueKey<String>('full-player-cover-placeholder-wrap'),
              child: _PlayerCoverPlaceholder(),
            )
          : SizedBox.expand(
              key: ValueKey<String>('full-player-cover-$resolvedUrl'),
              child: Image.network(
                resolvedUrl,
                key: const Key('full-player-cover-artwork'),
                width: double.infinity,
                height: double.infinity,
                fit: BoxFit.cover,
                headers: musicImageRequestHeaders(resolvedUrl),
                errorBuilder: (context, error, stackTrace) {
                  return const _PlayerCoverPlaceholder();
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
    return const Center(
      child: Icon(
        Icons.music_note_rounded,
        key: Key('full-player-cover-placeholder'),
        size: 96,
        color: Color(0xFFB6B8BF),
      ),
    );
  }
}

class _PlayerLyricsView extends StatefulWidget {
  const _PlayerLyricsView({
    super.key,
    required this.lyrics,
    required this.activeLyricIndex,
    required this.onSeekToLine,
  });

  final List<ParsedLyric> lyrics;
  final int activeLyricIndex;
  final ValueChanged<ParsedLyric> onSeekToLine;

  @override
  State<_PlayerLyricsView> createState() => _PlayerLyricsViewState();
}

class _PlayerLyricsViewState extends State<_PlayerLyricsView> {
  final ScrollController _scrollController = ScrollController();
  var _lineKeys = <GlobalKey>[];

  @override
  void initState() {
    super.initState();
    _syncLineKeys();
    _scheduleActiveLineScroll();
  }

  @override
  void didUpdateWidget(covariant _PlayerLyricsView oldWidget) {
    super.didUpdateWidget(oldWidget);
    final lyricsChanged = _lyricsChanged(oldWidget.lyrics, widget.lyrics);
    if (lyricsChanged) {
      _syncLineKeys();
    }
    if (oldWidget.activeLyricIndex != widget.activeLyricIndex ||
        lyricsChanged) {
      _scheduleActiveLineScroll();
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _syncLineKeys() {
    _lineKeys = List<GlobalKey>.generate(
      widget.lyrics.length,
      (_) => GlobalKey(),
      growable: false,
    );
  }

  bool _lyricsChanged(List<ParsedLyric> previous, List<ParsedLyric> next) {
    if (previous.length != next.length) {
      return true;
    }
    for (var index = 0; index < previous.length; index += 1) {
      final previousLine = previous[index];
      final nextLine = next[index];
      if (previousLine.time != nextLine.time ||
          previousLine.text != nextLine.text ||
          previousLine.translation != nextLine.translation) {
        return true;
      }
    }
    return false;
  }

  void _scheduleActiveLineScroll() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || !_scrollController.hasClients || _lineKeys.isEmpty) {
        return;
      }
      final index = widget.activeLyricIndex
          .clamp(0, _lineKeys.length - 1)
          .toInt();
      final context = _lineKeys[index].currentContext;
      if (context == null) {
        return;
      }
      Scrollable.ensureVisible(
        context,
        alignment: 0.5,
        duration: const Duration(milliseconds: 320),
        curve: Curves.easeOutCubic,
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    if (widget.lyrics.isEmpty) {
      return const Center(
        child: Text(
          '加载歌词中...',
          style: TextStyle(fontSize: 14, color: TuneFreePalette.textSecondary),
        ),
      );
    }

    return ShaderMask(
      shaderCallback: (bounds) {
        return const LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.transparent,
            Colors.black,
            Colors.black,
            Colors.transparent,
          ],
          stops: [0, 0.25, 0.75, 1],
        ).createShader(bounds);
      },
      blendMode: BlendMode.dstIn,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final verticalPadding = math.max(120.0, constraints.maxHeight * 0.4);
          return SingleChildScrollView(
            key: const Key('player-lyrics-view'),
            controller: _scrollController,
            padding: EdgeInsets.symmetric(vertical: verticalPadding),
            physics: const BouncingScrollPhysics(),
            child: SizedBox(
              width: constraints.maxWidth,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final entry in widget.lyrics.indexed) ...[
                    _PlayerLyricLine(
                      key: _lineKeys[entry.$1],
                      line: entry.$2,
                      index: entry.$1,
                      isActive: entry.$1 == widget.activeLyricIndex,
                      onSeekToLine: widget.onSeekToLine,
                    ),
                    if (entry.$1 != widget.lyrics.length - 1)
                      const SizedBox(height: 14),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PlayerLyricLine extends StatelessWidget {
  const _PlayerLyricLine({
    super.key,
    required this.line,
    required this.index,
    required this.isActive,
    required this.onSeekToLine,
  });

  final ParsedLyric line;
  final int index;
  final bool isActive;
  final ValueChanged<ParsedLyric> onSeekToLine;

  @override
  Widget build(BuildContext context) {
    final lineKey = Key(
      'player-lyrics-line-${isActive ? 'active' : 'inactive'}-$index',
    );
    final translationKey = Key(
      'player-lyrics-translation-${isActive ? 'active' : 'inactive'}-$index',
    );

    return GestureDetector(
      onTap: () => onSeekToLine(line),
      child: AnimatedScale(
        scale: isActive ? 1.03 : 1,
        duration: const Duration(milliseconds: 280),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                line.text,
                key: lineKey,
                textAlign: TextAlign.center,
                softWrap: true,
                style: TextStyle(
                  fontSize: isActive ? 24 : 20,
                  fontWeight: FontWeight.w700,
                  color: isActive
                      ? const Color(0xFF111111)
                      : TuneFreePalette.textSecondary,
                  height: 1.4,
                ),
              ),
              if (line.translation case final translation?) ...[
                const SizedBox(height: 6),
                Text(
                  translation,
                  key: translationKey,
                  textAlign: TextAlign.center,
                  softWrap: true,
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
        ),
      ),
    );
  }
}

class _SongInfoRow extends StatelessWidget {
  const _SongInfoRow({
    required this.title,
    required this.artist,
    required this.source,
    required this.isFavorite,
    required this.onDownload,
    required this.onFavorite,
  });

  final String title;
  final String artist;
  final String source;
  final bool isFavorite;
  final VoidCallback onDownload;
  final Future<void> Function() onFavorite;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedSwitcher(
                duration: const Duration(milliseconds: 240),
                switchInCurve: Curves.easeOutCubic,
                switchOutCurve: Curves.easeInCubic,
                transitionBuilder: (child, animation) {
                  final offset = Tween<Offset>(
                    begin: const Offset(0.04, 0),
                    end: Offset.zero,
                  ).animate(animation);
                  return FadeTransition(
                    opacity: animation,
                    child: SlideTransition(position: offset, child: child),
                  );
                },
                child: Text(
                  title,
                  key: ValueKey<String>('full-title-$source-$title'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.4,
                  ),
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
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      musicSourceBadgeLabel(source),
                      style: const TextStyle(
                        fontSize: 10,
                        color: Colors.white,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: const Duration(milliseconds: 240),
                      switchInCurve: Curves.easeOutCubic,
                      switchOutCurve: Curves.easeInCubic,
                      layoutBuilder: (currentChild, previousChildren) {
                        return Stack(
                          alignment: Alignment.centerLeft,
                          children: [...previousChildren, ?currentChild],
                        );
                      },
                      child: Text(
                        artist,
                        key: ValueKey<String>('full-artist-$source-$artist'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w500,
                          color: TuneFreePalette.accent,
                        ),
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
          onPressed: onDownload,
          icon: const Icon(Icons.download_rounded, color: Color(0xFF6B7280)),
        ),
        IconButton(
          key: const Key('player-like-button'),
          onPressed: onFavorite,
          icon: Icon(
            isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
            color: isFavorite
                ? TuneFreePalette.accent
                : const Color(0xFF6B7280),
          ),
        ),
      ],
    );
  }
}

class _PlayerVisualizer extends ConsumerStatefulWidget {
  const _PlayerVisualizer({required this.isPlaying});

  final bool isPlaying;

  @override
  ConsumerState<_PlayerVisualizer> createState() => _PlayerVisualizerState();
}

class _PlayerVisualizerState extends ConsumerState<_PlayerVisualizer>
    with SingleTickerProviderStateMixin {
  static const _barCount = audioSpectrumBarCount;
  static const _minBarPercent = 0.04;
  static const _decaySpeed = 0.92;

  late final Ticker _ticker;
  final _displayValues = List<double>.filled(_barCount, 0);
  final _targetValues = List<double>.filled(_barCount, 0);
  StreamSubscription<int?>? _sessionSubscription;
  StreamSubscription<List<double>>? _spectrumSubscription;
  Duration? _lastElapsed;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker(_tick);
    final engine = ref.read(playerEngineProvider);
    _connectToSession(engine.androidAudioSessionId);
    _sessionSubscription = engine.androidAudioSessionIdStream.listen(
      _connectToSession,
    );
  }

  @override
  void didUpdateWidget(covariant _PlayerVisualizer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.isPlaying != widget.isPlaying) {
      _clearTargetsAndTick();
    }
  }

  @override
  void dispose() {
    _sessionSubscription?.cancel();
    _spectrumSubscription?.cancel();
    _ticker.dispose();
    super.dispose();
  }

  void _connectToSession(int? audioSessionId) {
    _spectrumSubscription?.cancel();
    _spectrumSubscription = null;
    _clearTargetsAndTick();

    _spectrumSubscription = const AudioSpectrumAnalyzer()
        .watch(audioSessionId)
        .listen(_applySpectrum, onError: (_) => _clearTargetsAndTick());
  }

  void _applySpectrum(List<double> bars) {
    for (var index = 0; index < _barCount; index += 1) {
      _targetValues[index] = index < bars.length ? bars[index] : 0;
    }
    if (widget.isPlaying) {
      _ensureTicker();
    }
  }

  void _clearTargetsAndTick() {
    for (var index = 0; index < _barCount; index += 1) {
      _targetValues[index] = 0;
    }
    _ensureTicker();
  }

  void _ensureTicker() {
    _lastElapsed = null;
    if (!_ticker.isActive) {
      _ticker.start();
    }
  }

  void _tick(Duration elapsed) {
    final frameScale = _lastElapsed == null
        ? 1.0
        : ((elapsed - _lastElapsed!).inMicroseconds / 16666).clamp(0.5, 2.5);
    _lastElapsed = elapsed;

    var hasVisibleMotion = false;
    for (var index = 0; index < _barCount; index += 1) {
      final target = widget.isPlaying ? _targetValues[index] : 0.0;
      final current = _displayValues[index];
      if (target > current) {
        _displayValues[index] = current + (target - current) * 0.65;
      } else if (widget.isPlaying) {
        _displayValues[index] = current + (target - current) * 0.15;
      } else {
        _displayValues[index] *= math.pow(_decaySpeed, frameScale).toDouble();
      }
      hasVisibleMotion =
          hasVisibleMotion || _displayValues[index] > 0.01 || target > 0.01;
    }

    if (!hasVisibleMotion) {
      _ticker.stop();
      _lastElapsed = null;
    }

    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      key: const Key('player-visualizer'),
      height: 48,
      width: double.infinity,
      child: CustomPaint(
        painter: _VisualizerPainter(
          values: List<double>.unmodifiable(_displayValues),
        ),
      ),
    );
  }
}

class _VisualizerPainter extends CustomPainter {
  const _VisualizerPainter({required this.values});

  final List<double> values;

  @override
  void paint(Canvas canvas, Size size) {
    final slotWidth = size.width / values.length;
    final barWidth = slotWidth * 0.55;
    final paint = Paint()..style = PaintingStyle.fill;

    for (var index = 0; index < values.length; index += 1) {
      final percent = math.max(
        _PlayerVisualizerState._minBarPercent,
        values[index],
      );
      final barHeight = size.height * percent;
      final left = index * slotWidth + (slotWidth - barWidth) / 2;
      final top = size.height - barHeight;
      paint.color = Colors.black.withValues(alpha: 0.12 + percent * 0.38);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(left, top, barWidth, barHeight),
          Radius.circular(barWidth / 2),
        ),
        paint,
      );
    }
  }

  @override
  bool shouldRepaint(covariant _VisualizerPainter oldDelegate) {
    if (oldDelegate.values.length != values.length) {
      return true;
    }
    for (var index = 0; index < values.length; index += 1) {
      if (oldDelegate.values[index] != values[index]) {
        return true;
      }
    }
    return false;
  }
}

class _PlaybackControls extends StatelessWidget {
  const _PlaybackControls({
    required this.playMode,
    required this.isPlaying,
    required this.isLoading,
    required this.onTogglePlayMode,
    required this.onPrevious,
    required this.onTogglePlay,
    required this.onNext,
    required this.onQueue,
  });

  final String playMode;
  final bool isPlaying;
  final bool isLoading;
  final VoidCallback onTogglePlayMode;
  final VoidCallback onPrevious;
  final VoidCallback onTogglePlay;
  final VoidCallback onNext;
  final VoidCallback onQueue;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        IconButton(
          key: const Key('player-play-mode-button'),
          onPressed: onTogglePlayMode,
          icon: Icon(
            switch (playMode) {
              'loop' => Icons.repeat_one_rounded,
              'shuffle' => Icons.shuffle_rounded,
              _ => Icons.repeat_rounded,
            },
            size: 24,
            color: playMode == 'sequence'
                ? const Color(0xFF9CA3AF)
                : TuneFreePalette.accent,
          ),
        ),
        Row(
          children: [
            IconButton(
              key: const Key('player-prev-button'),
              onPressed: onPrevious,
              icon: const Icon(Icons.skip_previous_rounded, size: 40),
            ),
            const SizedBox(width: 12),
            SizedBox(
              width: 80,
              height: 80,
              child: FilledButton(
                key: const Key('player-primary-toggle'),
                onPressed: isLoading ? null : onTogglePlay,
                style: FilledButton.styleFrom(
                  shape: const CircleBorder(),
                  padding: EdgeInsets.zero,
                  backgroundColor: TuneFreePalette.textPrimary,
                  disabledBackgroundColor: TuneFreePalette.textPrimary,
                  shadowColor: Colors.black.withValues(alpha: 0.18),
                  elevation: 10,
                ),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 160),
                  child: isLoading
                      ? const SizedBox(
                          key: Key('player-primary-loading-indicator'),
                          width: 30,
                          height: 30,
                          child: CircularProgressIndicator(
                            strokeWidth: 3,
                            color: Colors.white,
                          ),
                        )
                      : Icon(
                          key: Key(
                            isPlaying
                                ? 'player-primary-pause-icon'
                                : 'player-primary-play-icon',
                          ),
                          isPlaying
                              ? Icons.pause_rounded
                              : Icons.play_arrow_rounded,
                          size: 36,
                          color: Colors.white,
                        ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            IconButton(
              key: const Key('player-next-button'),
              onPressed: onNext,
              icon: const Icon(Icons.skip_next_rounded, size: 40),
            ),
          ],
        ),
        IconButton(
          key: const Key('player-queue-button'),
          onPressed: onQueue,
          icon: const Icon(
            Icons.queue_music_rounded,
            color: Color(0xFF9CA3AF),
            size: 24,
          ),
        ),
      ],
    );
  }
}
