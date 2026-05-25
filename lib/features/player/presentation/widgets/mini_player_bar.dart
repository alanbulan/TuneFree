import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/network/music_url_normalizer.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import '../../../../shared/theme/tune_free_spacing.dart';
import '../../application/player_controller.dart';

class MiniPlayerBar extends ConsumerWidget {
  const MiniPlayerBar({
    super.key,
    this.horizontalPadding = 16,
    this.bottomPadding = 12,
    this.useBottomSafeArea = true,
  });

  final double horizontalPadding;
  final double bottomPadding;
  final bool useBottomSafeArea;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(playerControllerProvider);
    final song = state.currentSong;
    final hasSong = song != null;
    final title = hasSong ? song.name : 'TuneFree 音乐';
    final artist = hasSong ? song.artist : '听见世界的声音';

    return SafeArea(
      top: false,
      bottom: useBottomSafeArea,
      child: Padding(
        padding: EdgeInsets.fromLTRB(
          horizontalPadding,
          0,
          horizontalPadding,
          bottomPadding,
        ),
        child: _MiniPlayerCard(
          onTap: hasSong
              ? () => ref.read(playerControllerProvider.notifier).expand()
              : null,
          child: Stack(
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: [
                    _MiniPlayerArtwork(
                      artworkUrl: song?.pic,
                      isPlaying: state.isPlaying,
                      isLoading: state.isLoading,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 220),
                            switchInCurve: Curves.easeOutCubic,
                            switchOutCurve: Curves.easeInCubic,
                            child: Text(
                              title,
                              key: ValueKey<String>('mini-title-$title'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: TuneFreePalette.textPrimary,
                              ),
                            ),
                          ),
                          AnimatedSwitcher(
                            duration: const Duration(milliseconds: 220),
                            switchInCurve: Curves.easeOutCubic,
                            switchOutCurve: Curves.easeInCubic,
                            child: Text(
                              artist,
                              key: ValueKey<String>('mini-artist-$artist'),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontSize: 12,
                                color: TuneFreePalette.textSecondary,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    _MiniPlayerIconButton(
                      key: const Key('mini-player-play-toggle'),
                      onPressed: hasSong && !state.isLoading
                          ? () => ref
                                .read(playerControllerProvider.notifier)
                                .togglePlay()
                          : null,
                      icon: state.isPlaying
                          ? Icons.pause_rounded
                          : Icons.play_arrow_rounded,
                      isLoading: state.isLoading,
                    ),
                    const SizedBox(width: 8),
                    _MiniPlayerIconButton(
                      key: const Key('mini-player-next-button'),
                      onPressed: state.queue.isEmpty
                          ? null
                          : () => ref
                                .read(playerControllerProvider.notifier)
                                .playNext(),
                      icon: Icons.skip_next_rounded,
                    ),
                  ],
                ),
              ),
              if (state.isLoading)
                const Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: LinearProgressIndicator(
                    key: Key('mini-player-loading-progress'),
                    minHeight: 2,
                    color: TuneFreePalette.accent,
                    backgroundColor: Colors.transparent,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniPlayerCard extends StatefulWidget {
  const _MiniPlayerCard({required this.onTap, required this.child});

  final VoidCallback? onTap;
  final Widget child;

  @override
  State<_MiniPlayerCard> createState() => _MiniPlayerCardState();
}

class _MiniPlayerCardState extends State<_MiniPlayerCard> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween<double>(begin: 0, end: 1),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutCubic,
      builder: (context, value, child) {
        return Opacity(
          opacity: value,
          child: Transform.translate(
            offset: Offset(0, (1 - value) * 20),
            child: child,
          ),
        );
      },
      child: AnimatedScale(
        duration: const Duration(milliseconds: 110),
        curve: Curves.easeOut,
        scale: _pressed ? 0.98 : 1,
        child: SizedBox(
          height: TuneFreeSpacing.miniPlayerHeight,
          child: Material(
            color: TuneFreePalette.surface.withValues(alpha: 0.9),
            elevation: 8,
            shadowColor: Colors.black.withValues(alpha: 0.08),
            borderRadius: BorderRadius.circular(16),
            clipBehavior: Clip.antiAlias,
            child: InkWell(
              key: const Key('mini-player'),
              onTap: widget.onTap,
              onTapDown: widget.onTap == null
                  ? null
                  : (_) => setState(() => _pressed = true),
              onTapCancel: widget.onTap == null
                  ? null
                  : () => setState(() => _pressed = false),
              onTapUp: widget.onTap == null
                  ? null
                  : (_) => setState(() => _pressed = false),
              child: widget.child,
            ),
          ),
        ),
      ),
    );
  }
}

class _MiniPlayerIconButton extends StatelessWidget {
  const _MiniPlayerIconButton({
    super.key,
    required this.onPressed,
    required this.icon,
    this.isLoading = false,
  });

  final VoidCallback? onPressed;
  final IconData icon;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      onPressed: isLoading ? null : onPressed,
      icon: AnimatedSwitcher(
        duration: const Duration(milliseconds: 160),
        child: isLoading
            ? const SizedBox(
                key: Key('mini-player-loading-indicator'),
                width: 18,
                height: 18,
                child: CircularProgressIndicator(
                  strokeWidth: 2.2,
                  color: TuneFreePalette.textPrimary,
                ),
              )
            : Icon(
                icon,
                key: ValueKey<IconData>(icon),
                color: TuneFreePalette.textPrimary,
              ),
      ),
      iconSize: 24,
      padding: EdgeInsets.zero,
      constraints: const BoxConstraints.tightFor(width: 32, height: 40),
      visualDensity: VisualDensity.compact,
    );
  }
}

class _MiniPlayerArtwork extends StatelessWidget {
  const _MiniPlayerArtwork({
    required this.artworkUrl,
    required this.isPlaying,
    required this.isLoading,
  });

  static const _spinDuration = Duration(seconds: 8);

  final String? artworkUrl;
  final bool isPlaying;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = artworkUrl?.trim();
    final decoration = BoxDecoration(
      shape: BoxShape.circle,
      color: const Color(0xFFF3F4F6),
      border: Border.all(color: TuneFreePalette.border),
    );

    final artwork = resolvedUrl == null || resolvedUrl.isEmpty
        ? Container(
            width: 40,
            height: 40,
            decoration: decoration,
            child: ClipOval(
              child: _MiniPlayerRotation(
                isPlaying: isPlaying,
                child: _MiniPlayerPlaceholder(isPlaying: isPlaying),
              ),
            ),
          )
        : Container(
            width: 40,
            height: 40,
            decoration: decoration,
            child: ClipOval(
              child: _MiniPlayerRotation(
                isPlaying: isPlaying,
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 240),
                  switchInCurve: Curves.easeOutCubic,
                  switchOutCurve: Curves.easeInCubic,
                  child: SizedBox.expand(
                    key: ValueKey<String>('mini-artwork-$resolvedUrl'),
                    child: Image.network(
                      resolvedUrl,
                      key: const Key('mini-player-artwork'),
                      fit: BoxFit.cover,
                      headers: musicImageRequestHeaders(resolvedUrl),
                      errorBuilder: (context, error, stackTrace) {
                        return _MiniPlayerPlaceholder(isPlaying: isPlaying);
                      },
                    ),
                  ),
                ),
              ),
            ),
          );

    return AnimatedScale(
      duration: const Duration(milliseconds: 260),
      curve: Curves.easeOutCubic,
      scale: isLoading ? 1.07 : 1,
      child: artwork,
    );
  }
}

class _MiniPlayerPlaceholder extends StatelessWidget {
  const _MiniPlayerPlaceholder({required this.isPlaying});

  final bool isPlaying;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      key: const Key('mini-player-placeholder'),
      color: const Color(0xFFF3F4F6),
      child: Icon(
        Icons.music_note_rounded,
        color: isPlaying ? TuneFreePalette.accent : const Color(0xFF9CA3AF),
        size: 22,
      ),
    );
  }
}

class _MiniPlayerRotation extends StatefulWidget {
  const _MiniPlayerRotation({required this.isPlaying, required this.child});

  final bool isPlaying;
  final Widget child;

  @override
  State<_MiniPlayerRotation> createState() => _MiniPlayerRotationState();
}

class _MiniPlayerRotationState extends State<_MiniPlayerRotation>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: _MiniPlayerArtwork._spinDuration,
    );
    if (widget.isPlaying) {
      _controller.repeat();
    }
  }

  @override
  void didUpdateWidget(covariant _MiniPlayerRotation oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.isPlaying == oldWidget.isPlaying) {
      return;
    }
    if (widget.isPlaying) {
      _controller.repeat();
    } else {
      _controller.stop(canceled: false);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return RotationTransition(
      key: const Key('mini-player-rotation'),
      turns: _controller,
      child: widget.child,
    );
  }
}
