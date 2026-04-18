import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
        child: Material(
          color: Colors.white.withValues(alpha: 0.92),
          elevation: 8,
          borderRadius: BorderRadius.circular(20),
          child: InkWell(
            key: const Key('mini-player'),
            borderRadius: BorderRadius.circular(20),
            onTap: hasSong
                ? () => ref.read(playerControllerProvider.notifier).expand()
                : null,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  _MiniPlayerArtwork(
                    artworkUrl: song?.pic,
                    isPlaying: state.isPlaying,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          artist,
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
                    key: const Key('mini-player-play-toggle'),
                    onPressed: hasSong
                        ? () {
                            ref
                                .read(playerControllerProvider.notifier)
                                .togglePlay();
                          }
                        : null,
                    icon: Icon(
                      state.isPlaying
                          ? Icons.pause_rounded
                          : Icons.play_arrow_rounded,
                      color: const Color(0xFF111111),
                    ),
                  ),
                  IconButton(
                    key: const Key('mini-player-next-button'),
                    onPressed: state.queue.isEmpty
                        ? null
                        : () {
                            ref
                                .read(playerControllerProvider.notifier)
                                .playNext();
                          },
                    icon: const Icon(
                      Icons.skip_next_rounded,
                      color: Color(0xFF111111),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MiniPlayerArtwork extends StatelessWidget {
  const _MiniPlayerArtwork({required this.artworkUrl, required this.isPlaying});

  static const _spinDuration = Duration(seconds: 12);

  final String? artworkUrl;
  final bool isPlaying;

  @override
  Widget build(BuildContext context) {
    final resolvedUrl = artworkUrl?.trim();
    final decoration = BoxDecoration(
      shape: BoxShape.circle,
      color: const Color(0xFFF3F4F6),
      border: Border.all(color: const Color(0xFFE5E7EB)),
    );

    if (resolvedUrl == null || resolvedUrl.isEmpty) {
      return Container(
        key: const Key('mini-player-placeholder'),
        width: 40,
        height: 40,
        decoration: decoration,
        child: _MiniPlayerRotation(
          isPlaying: isPlaying,
          child: Icon(
            Icons.music_note_rounded,
            color: isPlaying
                ? const Color(0xFFE94B5B)
                : const Color(0xFF9CA3AF),
          ),
        ),
      );
    }

    return Container(
      width: 40,
      height: 40,
      decoration: decoration,
      child: ClipOval(
        child: _MiniPlayerRotation(
          isPlaying: isPlaying,
          child: Image.network(
            resolvedUrl,
            key: const Key('mini-player-artwork'),
            fit: BoxFit.cover,
            errorBuilder: (context, error, stackTrace) {
              return Container(
                key: const Key('mini-player-placeholder'),
                color: const Color(0xFFF3F4F6),
                child: Icon(
                  Icons.music_note_rounded,
                  color: isPlaying
                      ? const Color(0xFFE94B5B)
                      : const Color(0xFF9CA3AF),
                ),
              );
            },
          ),
        ),
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
