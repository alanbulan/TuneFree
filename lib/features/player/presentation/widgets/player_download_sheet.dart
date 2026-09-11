import 'dart:async';

import 'package:material_ui/material_ui.dart';
import '../../../../shared/theme/tune_free_palette.dart';

import '../../../../core/models/audio_quality.dart';
import '../../../../core/models/song.dart';
import '../../data/player_download_manager.dart';
import 'player_bottom_sheet_transition.dart';

class PlayerDownloadSheet extends StatefulWidget {
  const PlayerDownloadSheet({
    super.key,
    required this.isOpen,
    required this.song,
    required this.selectedQuality,
    required this.onDownload,
    required this.onClose,
  });

  final bool isOpen;
  final Song? song;
  final AudioQuality selectedQuality;
  final Future<DownloadResult> Function(AudioQuality quality) onDownload;
  final VoidCallback onClose;

  @override
  State<PlayerDownloadSheet> createState() => _PlayerDownloadSheetState();
}

class _PlayerDownloadSheetState extends State<PlayerDownloadSheet> {
  AudioQuality? _preparingQuality;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    if (!widget.isOpen) {
      return const SizedBox.shrink();
    }

    final activeSong = widget.song;

    return PlayerBottomSheetTransition(
      onClose: widget.onClose,
      child: Container(
        key: const Key('player-download-sheet'),
        decoration: BoxDecoration(
          color: TuneFreeColors.of(context).surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          activeSong?.name ?? '当前歌曲',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: Theme.of(context).textTheme.titleLarge
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '选择下载音质',
                          style: TextStyle(
                            fontSize: 12,
                            color: colors.textSubtle,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    key: const Key('player-download-close-button'),
                    onPressed: widget.onClose,
                    icon: const Icon(Icons.close_rounded),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              ...AudioQuality.values.map(
                (quality) => Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _DownloadOptionTile(
                    quality: quality,
                    isSelected: quality == widget.selectedQuality,
                    isPreparing: quality == _preparingQuality,
                    onTap: activeSong == null
                        ? null
                        : () async {
                            if (_preparingQuality != null) {
                              return;
                            }
                            setState(() {
                              _preparingQuality = quality;
                            });
                            try {
                              final result = await widget.onDownload(quality);
                              if (!context.mounted) {
                                return;
                              }
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    result.alreadyExisted
                                        ? '该音质已下载'
                                        : '已下载到本地：${result.fileName}',
                                  ),
                                ),
                              );
                              if (!result.alreadyExisted) {
                                widget.onClose();
                              }
                            } catch (_) {
                              if (!context.mounted) {
                                return;
                              }
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('下载失败，请稍后重试')),
                              );
                            } finally {
                              if (mounted) {
                                setState(() {
                                  _preparingQuality = null;
                                });
                              }
                            }
                          },
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DownloadOptionTile extends StatelessWidget {
  const _DownloadOptionTile({
    required this.quality,
    required this.isSelected,
    required this.isPreparing,
    required this.onTap,
  });

  final AudioQuality quality;
  final bool isSelected;
  final bool isPreparing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: Key('player-download-option-${quality.wireValue}'),
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Ink(
          decoration: BoxDecoration(
            color: isSelected
                ? colors.accentSoft
                : colors.fillFaint,
            borderRadius: BorderRadius.circular(18),
            border: Border.all(
              color: isSelected ? colors.accent : Colors.transparent,
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        quality.downloadLabel,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        quality.downloadDescription,
                        style: TextStyle(
                          fontSize: 12,
                          color: colors.textSubtle,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    shape: BoxShape.circle,
                    border: isSelected
                        ? Border.all(color: colors.accent)
                        : null,
                  ),
                  child: isPreparing
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Icon(
                          isSelected
                              ? Icons.check_rounded
                              : Icons.download_rounded,
                          color: isSelected
                              ? colors.accent
                              : colors.textMuted,
                          size: 18,
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
