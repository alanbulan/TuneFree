import 'dart:async';
import 'dart:math' as math;
import 'dart:ui';

import 'package:material_ui/material_ui.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/models/lyric_timeline.dart';
import '../../../../core/models/parsed_lyric.dart';
import '../../../../core/utils/lyric_word_state.dart';
import '../../../../shared/widgets/music_network_image.dart';
import '../../../../shared/music_source_display.dart';
import '../../../../shared/theme/appearance_controller.dart';
import '../../../../shared/theme/appearance_preferences.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import '../../../../shared/widgets/tune_free_feedback.dart';
import '../../../library/application/library_controller.dart';
import '../../application/audio_spectrum_analyzer.dart';
import '../../application/player_controller.dart';
import '../../application/player_lyrics_controller.dart';
import '../../data/player_download_service.dart';
import '../../domain/player_state.dart';
import 'player_download_sheet.dart';
import 'player_more_sheet.dart';
import 'player_queue_sheet.dart';

/// 把位置冻住，供只关心其它字段的地方 watch。
///
/// 位置流实测约 5Hz（just_audio 的 `positionStream` 在 4 分钟的曲目上会落到
/// 200ms 上限）。全屏播放器里有模糊封面、频谱和四个 sheet，让整棵树跟着位置
/// 重建代价太大 —— 位置只交给真正要用它的两个子树自己去 `select`。
/// freezed 的 `==` 是深比较，冻住之后两次 tick 判等，`select` 不会触发重建。
PlayerState _withoutPosition(PlayerState state) =>
    state.copyWith(position: Duration.zero);

String _formatSeconds(int totalSeconds) {
  final minutes = totalSeconds ~/ 60;
  final seconds = totalSeconds % 60;
  return '$minutes:${seconds.toString().padLeft(2, '0')}';
}

class FullPlayerSheet extends ConsumerWidget {
  const FullPlayerSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = TuneFreeColors.of(context);
    final state = ref.watch(playerControllerProvider.select(_withoutPosition));
    final song = state.currentSong;

    if (song == null) {
      return const SizedBox.shrink();
    }

    final playerController = ref.read(playerControllerProvider.notifier);
    final downloadService = ref.read(playerDownloadServiceProvider);
    final libraryController = ref.watch(libraryControllerProvider);
    final isFavorite = libraryController.isFavoriteSong(song);

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
                    color: colors.surface,
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
                                    horizontal: state.showLyrics ? 18 : 28,
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
                                          ? const _PlayerLyricsPanel(
                                              key: Key(
                                                'player-lyrics-panel',
                                              ),
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
                                  28,
                                  8,
                                  28,
                                  12,
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
                                        final library = ref.read(
                                          libraryControllerProvider,
                                        );
                                        // 收藏/取消收藏原来完全没有反馈，
                                        // 这里补上提示条与撤销（再切一次即还原）。
                                        final wasFavorite = library
                                            .isFavoriteSong(song);
                                        await library.toggleFavorite(song);
                                        if (!context.mounted) {
                                          return;
                                        }
                                        showUndoToast(
                                          context,
                                          wasFavorite
                                              ? '已取消收藏'
                                              : '已加入我喜欢',
                                          tone: wasFavorite
                                              ? TuneFreeToastTone.info
                                              : TuneFreeToastTone.success,
                                          onUndo: () =>
                                              library.toggleFavorite(song),
                                        );
                                      },
                                    ),
                                    const SizedBox(height: 12),
                                    _PlayerVisualizer(
                                      isPlaying: state.isPlaying,
                                    ),
                                    const SizedBox(height: 4),
                                    const _PlaybackProgressBar(),
                                    const SizedBox(height: 12),
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
                          onClearQueue: () async {
                            // 清空队列会把当前歌、播放位置和落盘记录一起清掉，
                            // 所以快照要包括当前歌；撤销只能走 playSong 重新
                            // 起播 —— 光把 queue 写回去会留下「有队列但没在放」
                            // 的中间态。
                            final previousSong = state.currentSong;
                            final previousQueue = state.queue;
                            await playerController.clearQueue();
                            if (!context.mounted || previousSong == null) {
                              return;
                            }
                            showUndoToast(
                              context,
                              '已清空播放队列',
                              tone: TuneFreeToastTone.warning,
                              onUndo: () => playerController.playSong(
                                previousSong,
                                queue: previousQueue,
                                forceQuality: state.audioQuality,
                              ),
                            );
                          },
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
                          album: song.album,
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
}

/// 进度条与两端的时长。位置只有在这里和歌词面板里被 watch。
class _PlaybackProgressBar extends ConsumerWidget {
  const _PlaybackProgressBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = TuneFreeColors.of(context);
    final position = ref.watch(
      playerControllerProvider.select((state) => state.position),
    );
    final duration = ref.watch(
      playerControllerProvider.select((state) => state.duration),
    );

    final durationSeconds = duration.inSeconds == 0 ? 1 : duration.inSeconds;
    final positionSeconds = position.inSeconds.clamp(0, durationSeconds);

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Slider(
          value: positionSeconds.toDouble(),
          max: durationSeconds.toDouble(),
          // 只覆盖已唱部分：播放器的进度条是黑白的（随主题在深/浅之间走），
          // 而不是强调色。未唱部分交给主题的 `sliderTheme.inactiveTrackColor`
          // —— 这里以前写死了浅色的 #D1D5DB，暗色主题下那道轨道会太亮。
          activeColor: colors.textPrimary,
          onChanged: (value) {
            ref
                .read(playerControllerProvider.notifier)
                .seek(Duration(seconds: value.round()));
          },
        ),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              _formatSeconds(positionSeconds),
              style: TextStyle(fontSize: 12, color: colors.textMuted),
            ),
            Text(
              _formatSeconds(durationSeconds),
              style: TextStyle(fontSize: 12, color: colors.textMuted),
            ),
          ],
        ),
      ],
    );
  }
}

/// 歌词面板。全屏播放器里唯一需要跟着位置走的部分。
///
/// 只订阅**当前行索引**（一个 int），不订阅位置本身：位置每 200ms 跳一次，
/// 而索引整行才变一次。逐字填充的频率由当前那一行自己订阅位置去扛，
/// 这样整块歌词列表不会被位置流反复重建。
class _PlayerLyricsPanel extends ConsumerWidget {
  const _PlayerLyricsPanel({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 只跟踪原始歌词串：换歌时它才会变。
    final rawLyrics = ref.watch(
      playerControllerProvider.select(
        (state) => state.currentSong?.lrc ?? '',
      ),
    );

    final preferences = ref.watch(
      appearanceControllerProvider.select(
        (controller) => controller.preferences,
      ),
    );
    // 偏移只在这一层加：时间轴本身保持纯净，否则按原始串记忆化的缓存
    // 会因为拖一下滑块就整条作废（还得重新估算逐字）。
    final offset = preferences.lyricOffset;

    final timeline = ref.watch(playerLyricsControllerProvider).buildLyrics(
      rawLyrics,
    );
    final activeLyricIndex = ref.watch(
      playerControllerProvider.select(
        (state) => timeline.activeIndexAt(
          (state.position + offset).inMicroseconds /
              Duration.microsecondsPerSecond,
        ),
      ),
    );

    return _PlayerLyricsView(
      lyrics: timeline,
      activeLyricIndex: activeLyricIndex,
      lyricSize: preferences.lyricSize,
      lyricFont: preferences.lyricFont,
      onSeekToLine: (line) {
        ref
            .read(playerControllerProvider.notifier)
            .seek(lyricSeekTarget(line.time, offset));
      },
    );
  }
}

class _AmbientArtworkBackground extends StatelessWidget {
  const _AmbientArtworkBackground({required this.artworkUrl});

  final String? artworkUrl;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
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
                      child: MusicNetworkImage(
                        resolvedUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            const SizedBox.shrink(),
                      ),
                    ),
                  ),
                ),
        ),
        ColoredBox(color: colors.surface.withValues(alpha: 0.62)),
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
    final colors = TuneFreeColors.of(context);
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
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 4),
        child: Row(
          children: [
            IconButton(
              key: const Key('close-full-player'),
              onPressed: widget.onClose,
              icon: Icon(
                Icons.expand_more_rounded,
                size: 28,
                color: colors.textMuted,
              ),
            ),
            Expanded(
              child: Center(
                child: SizedBox(
                  width: 36,
                  child: DecoratedBox(
                    decoration: BoxDecoration(
                      // 这条拖动指示条以前写死成浅灰，暗色主题下是一道刺眼的
                      // 亮线。跟着主题的「分隔线」色走。
                      color: colors.separator,
                      borderRadius: const BorderRadius.all(
                        Radius.circular(999),
                      ),
                    ),
                    child: const SizedBox(height: 4),
                  ),
                ),
              ),
            ),
            IconButton(
              key: const Key('player-more-button'),
              onPressed: widget.onMore,
              icon: Icon(
                Icons.more_horiz_rounded,
                size: 24,
                color: colors.textMuted,
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
    final colors = TuneFreeColors.of(context);
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
                      color: colors.fillSubtle,
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
              child: MusicNetworkImage(
                resolvedUrl,
                key: const Key('full-player-cover-artwork'),
                width: double.infinity,
                height: double.infinity,
                fit: BoxFit.cover,
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
    final colors = TuneFreeColors.of(context);
    return Center(
      child: Icon(
        Icons.music_note_rounded,
        key: Key('full-player-cover-placeholder'),
        size: 96,
        color: colors.lyricInactive,
      ),
    );
  }
}

class _PlayerLyricsView extends StatefulWidget {
  const _PlayerLyricsView({
    required this.lyrics,
    required this.activeLyricIndex,
    required this.lyricSize,
    required this.lyricFont,
    required this.onSeekToLine,
  });

  final LyricTimeline lyrics;
  final int activeLyricIndex;
  final int lyricSize;
  final LyricFontOption lyricFont;
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
    // 时间轴按原始歌词串记忆化，同一首歌永远是同一个实例 ——
    // 所以这里可以直接比引用，不必逐行比对。
    final lyricsChanged = !identical(oldWidget.lyrics, widget.lyrics);
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
    final colors = TuneFreeColors.of(context);
    if (widget.lyrics.isEmpty) {
      return Center(
        child: Text(
          '加载歌词中...',
          style: TextStyle(fontSize: 14, color: colors.textSecondary),
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
          final verticalPadding = math.max(96.0, constraints.maxHeight * 0.34);
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
                  for (final entry in widget.lyrics.lines.indexed) ...[
                    _PlayerLyricLine(
                      key: _lineKeys[entry.$1],
                      entry: entry.$2,
                      index: entry.$1,
                      isActive: entry.$1 == widget.activeLyricIndex,
                      lyricSize: widget.lyricSize,
                      lyricFont: widget.lyricFont,
                      onSeekToLine: widget.onSeekToLine,
                    ),
                    if (entry.$1 != widget.lyrics.length - 1)
                      const SizedBox(height: 10),
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
    required this.entry,
    required this.index,
    required this.isActive,
    required this.lyricSize,
    required this.lyricFont,
    required this.onSeekToLine,
  });

  final TimedLyricLine entry;
  final int index;
  final bool isActive;
  final int lyricSize;
  final LyricFontOption lyricFont;
  final ValueChanged<ParsedLyric> onSeekToLine;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    final line = entry.line;
    final lineKey = Key(
      'player-lyrics-line-${isActive ? 'active' : 'inactive'}-$index',
    );
    final translationKey = Key(
      'player-lyrics-translation-${isActive ? 'active' : 'inactive'}-$index',
    );
    final romanizationKey = Key(
      'player-lyrics-romanization-${isActive ? 'active' : 'inactive'}-$index',
    );

    // 当前行比其余行大一档，译文再小一档；三档都由用户的「歌词字号」推出来。
    // 字号 22（默认值）时正好是改造前的 22 / 18 / 14 / 12。
    final lineFontSize = (isActive ? lyricSize : lyricSize - 4)
        .clamp(12, 48)
        .toDouble();
    final translationFontSize = (isActive ? lyricSize - 8 : lyricSize - 10)
        .clamp(10, 40)
        .toDouble();

    return GestureDetector(
      onTap: () => onSeekToLine(line),
      child: AnimatedScale(
        scale: isActive ? 1.02 : 1,
        duration: const Duration(milliseconds: 280),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (isActive && entry.hasWords)
                _ActiveLyricLine(
                  key: Key('player-lyric-fill-$index'),
                  entry: entry,
                  textKey: lineKey,
                  style: lyricFont.apply(
                    TextStyle(
                      fontSize: lineFontSize,
                      fontWeight: FontWeight.w700,
                      color: colors.textStrong,
                      height: 1.35,
                    ),
                  ),
                  filledColor: colors.accent,
                )
              else
                Text(
                  line.text,
                  key: lineKey,
                  textAlign: TextAlign.center,
                  softWrap: true,
                  style: lyricFont.apply(
                    TextStyle(
                      fontSize: lineFontSize,
                      fontWeight: FontWeight.w700,
                      color: isActive
                          ? colors.textStrong
                          : colors.textSecondary,
                      height: 1.35,
                    ),
                  ),
                ),
              // 扩展轨的顺序与 Tauri 一致：罗马音在前，译文在后。
              if (line.romanization case final romanization?) ...[
                const SizedBox(height: 6),
                Text(
                  romanization,
                  key: romanizationKey,
                  textAlign: TextAlign.center,
                  softWrap: true,
                  style: lyricFont.apply(
                    TextStyle(
                      fontSize: translationFontSize,
                      fontWeight: FontWeight.w500,
                      color: isActive
                          ? colors.textTertiary
                          : colors.lyricInactive,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
              if (line.translation case final translation?) ...[
                const SizedBox(height: 6),
                Text(
                  translation,
                  key: translationKey,
                  textAlign: TextAlign.center,
                  softWrap: true,
                  style: lyricFont.apply(
                    TextStyle(
                      fontSize: translationFontSize,
                      fontWeight: FontWeight.w500,
                      color: isActive
                          ? colors.lyricTranslation
                          : colors.lyricInactive,
                      height: 1.35,
                    ),
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

/// 只订阅播放位置，让「跟着位置重建」的范围缩到当前这一行。
class _ActiveLyricLine extends ConsumerWidget {
  const _ActiveLyricLine({
    super.key,
    required this.entry,
    required this.textKey,
    required this.style,
    required this.filledColor,
  });

  final TimedLyricLine entry;
  final Key textKey;
  final TextStyle style;
  final Color filledColor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final position = ref.watch(
      playerControllerProvider.select((state) => state.position),
    );
    final isPlaying = ref.watch(
      playerControllerProvider.select((state) => state.isPlaying),
    );
    final offset = ref.watch(
      appearanceControllerProvider.select(
        (controller) => controller.preferences.lyricOffset,
      ),
    );

    return _KaraokeLyricText(
      text: entry.line.text,
      words: entry.words,
      endTime: entry.endTime,
      currentTime:
          (position + offset).inMicroseconds /
          Duration.microsecondsPerSecond,
      isPlaying: isPlaying,
      textKey: textKey,
      style: style,
      filledColor: filledColor,
    );
  }
}

/// 卡拉OK 填充：整行一层 `Text` 排版，外面套一层 [ShaderMask]，用**硬停**
/// 渐变把已经唱到的部分染成强调色。
///
/// 用硬停而不是软边：软边看起来像发光，不是卡拉OK 的观感。
///
/// 之所以按整行连续推进、而不是逐字裁切：Flutter 侧的歌词源只有整行时间轴，
/// 词边界本身就是按版面宽度估出来的，逐字跳变反而比连续推进更假。
/// 真·逐字源（网易 yrc）接进来之后，这里换成按词裁切即可，数据层不用动。
class _KaraokeLyricText extends StatefulWidget {
  const _KaraokeLyricText({
    required this.text,
    required this.words,
    required this.endTime,
    required this.currentTime,
    required this.isPlaying,
    required this.textKey,
    required this.style,
    required this.filledColor,
  });

  final String text;
  final List<LyricWord> words;
  final double endTime;
  final double currentTime;
  final bool isPlaying;
  final Key textKey;
  final TextStyle style;
  final Color filledColor;

  @override
  State<_KaraokeLyricText> createState() => _KaraokeLyricTextState();
}

class _KaraokeLyricTextState extends State<_KaraokeLyricText>
    with SingleTickerProviderStateMixin {
  late final Ticker _ticker;

  /// 位置流只有 ~5Hz，两次更新之间靠 Ticker 外推，否则填充是一跳一跳的。
  /// 外推永远是「从上一次位置流的值 + 经过的帧时间」，位置流一来就重新立锚，
  /// 所以不会累积漂移。
  Duration? _anchorElapsed;
  double? _anchorTime;
  late double _renderTime;

  @override
  void initState() {
    super.initState();
    _renderTime = widget.currentTime;
    _ticker = createTicker(_onTick);
  }

  @override
  void didUpdateWidget(covariant _KaraokeLyricText oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentTime == oldWidget.currentTime &&
        widget.isPlaying == oldWidget.isPlaying) {
      return;
    }

    _renderTime = widget.currentTime;
    _anchorElapsed = null;
    _anchorTime = null;

    // 只有位置**确实在推进**时才外推。暂停、缓冲、拖动进度条时位置不动，
    // 这时候外推只会跑到音频前面去 —— 不启动反而更准。
    final isAdvancing = widget.currentTime > oldWidget.currentTime;
    if (widget.isPlaying && isAdvancing && widget.currentTime < widget.endTime) {
      _ensureTicker();
    } else {
      _stopTicker();
    }
  }

  @override
  void dispose() {
    _ticker.dispose();
    super.dispose();
  }

  void _ensureTicker() {
    if (!_ticker.isActive) {
      _ticker.start();
    }
  }

  void _stopTicker() {
    if (_ticker.isActive) {
      _ticker.stop();
    }
  }

  void _onTick(Duration elapsed) {
    final anchorTime = _anchorTime;
    final anchorElapsed = _anchorElapsed;
    if (anchorTime == null || anchorElapsed == null) {
      // 第一帧只立锚点：此时 elapsed 与位置锚点还没有对应关系。
      _anchorTime = widget.currentTime;
      _anchorElapsed = elapsed;
      return;
    }

    final elapsedSeconds =
        (elapsed - anchorElapsed).inMicroseconds /
        Duration.microsecondsPerSecond;
    // 外推到这一行唱完为止 —— 也给 Ticker 一个必然的终点，
    // 它不会无休止地排帧。
    final next = math.min(anchorTime + elapsedSeconds, widget.endTime);
    if (next >= widget.endTime) {
      _stopTicker();
    }
    if (next != _renderTime) {
      setState(() => _renderTime = next);
    }
  }

  @override
  Widget build(BuildContext context) {
    final progress = lyricLineProgress(
      widget.words,
      _renderTime,
    ).clamp(0.0, 1.0);
    final pendingColor = widget.style.color ?? widget.filledColor;

    final text = Text(
      widget.text,
      key: widget.textKey,
      textAlign: TextAlign.center,
      softWrap: true,
      style: widget.style.copyWith(
        color: progress >= 1 ? widget.filledColor : pendingColor,
      ),
    );

    // `Center` 让文本按实际宽度收窄，[ShaderMask] 的 bounds 才是这一行的宽度；
    // 否则渐变会横跨整个面板，短句的填充边会从空白处起步。
    //
    // 还没开唱和已经唱完这两种情形不需要合成层，直接给纯色文本。
    if (progress <= 0 || progress >= 1) {
      return RepaintBoundary(child: Center(child: text));
    }

    return RepaintBoundary(
      child: Center(
        child: ShaderMask(
          blendMode: BlendMode.srcIn,
          shaderCallback: (bounds) => LinearGradient(
            begin: Alignment.centerLeft,
            end: Alignment.centerRight,
            // 两个断点重合 = 硬边：左边是已唱，右边是未唱。
            colors: <Color>[
              widget.filledColor,
              widget.filledColor,
              pendingColor,
              pendingColor,
            ],
            stops: <double>[0, progress, progress, 1],
          ).createShader(bounds),
          child: text,
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
    final colors = TuneFreeColors.of(context);
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
                    fontSize: 24,
                    fontWeight: FontWeight.w700,
                    letterSpacing: -0.3,
                  ),
                ),
              ),
              const SizedBox(height: 6),
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: colors.textTertiary,
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
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w500,
                          color: colors.accent,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 10),
        IconButton(
          key: const Key('player-download-button'),
          onPressed: onDownload,
          iconSize: 22,
          icon: Icon(Icons.download_rounded, color: colors.textMuted),
        ),
        IconButton(
          key: const Key('player-like-button'),
          onPressed: onFavorite,
          iconSize: 22,
          icon: Icon(
            isFavorite ? Icons.favorite_rounded : Icons.favorite_border_rounded,
            color: isFavorite
                ? colors.accent
                : colors.textMuted,
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
      height: 38,
      width: double.infinity,
      child: CustomPaint(
        painter: _VisualizerPainter(
          values: List<double>.unmodifiable(_displayValues),
          barColor: TuneFreeColors.of(context).visualizerBar,
        ),
      ),
    );
  }
}

class _VisualizerPainter extends CustomPainter {
  const _VisualizerPainter({required this.values, required this.barColor});

  final List<double> values;

  /// 频谱柱颜色。浅色下是深色、深色下是浅色 —— 写死黑色的话，
  /// 在深色背景上整片频谱等于看不见（这正是一个已有的问题）。
  final Color barColor;

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
      paint.color = barColor.withValues(alpha: 0.12 + percent * 0.38);
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
    final colors = TuneFreeColors.of(context);
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
            size: 22,
            color: playMode == 'sequence'
                ? colors.textTertiary
                : colors.accent,
          ),
        ),
        Row(
          children: [
            IconButton(
              key: const Key('player-prev-button'),
              onPressed: onPrevious,
              icon: const Icon(Icons.skip_previous_rounded, size: 34),
            ),
            const SizedBox(width: 8),
            SizedBox(
              width: 68,
              height: 68,
              child: FilledButton(
                key: const Key('player-primary-toggle'),
                onPressed: isLoading ? null : onTogglePlay,
                style: FilledButton.styleFrom(
                  shape: const CircleBorder(),
                  padding: EdgeInsets.zero,
                  backgroundColor: colors.textPrimary,
                  disabledBackgroundColor: colors.textPrimary,
                  shadowColor: Colors.black.withValues(alpha: 0.18),
                  elevation: 10,
                ),
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 160),
                  child: isLoading
                      ? const SizedBox(
                          key: Key('player-primary-loading-indicator'),
                          width: 26,
                          height: 26,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.6,
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
                          size: 30,
                          color: Colors.white,
                        ),
                ),
              ),
            ),
            const SizedBox(width: 8),
            IconButton(
              key: const Key('player-next-button'),
              onPressed: onNext,
              icon: const Icon(Icons.skip_next_rounded, size: 34),
            ),
          ],
        ),
        IconButton(
          key: const Key('player-queue-button'),
          onPressed: onQueue,
          icon: Icon(
            Icons.queue_music_rounded,
            color: colors.textTertiary,
            size: 22,
          ),
        ),
      ],
    );
  }
}
