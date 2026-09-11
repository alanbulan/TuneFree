import 'dart:async';

import 'package:material_ui/material_ui.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../core/models/audio_quality.dart';
import '../../../../core/models/music_source.dart';
import '../../../../core/models/song.dart';
import '../../../../shared/widgets/tune_free_feedback.dart';
import '../../../library/application/library_controller.dart';
import '../../../search/application/search_providers.dart';
import '../../application/player_controller.dart';
import '../../domain/player_track.dart';
import 'player_bottom_sheet_transition.dart';

class PlayerMoreSheet extends ConsumerWidget {
  const PlayerMoreSheet({
    super.key,
    required this.isOpen,
    required this.track,
    required this.selectedQuality,
    required this.onSelectQuality,
    required this.onClose,
    this.album,
  });

  final bool isOpen;
  final PlayerTrack? track;
  final AudioQuality selectedQuality;
  final Future<void> Function(AudioQuality) onSelectQuality;
  final VoidCallback onClose;

  /// 当前歌曲的专辑名。
  ///
  /// 单独传进来而不是挂到 [PlayerTrack] 上：只有「搜索专辑」这一个消费者，
  /// 而给 PlayerTrack 加字段要连带改代码生成和 20 多处构造点，不划算。
  final String? album;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = TuneFreeColors.of(context);
    if (!isOpen) {
      return const SizedBox.shrink();
    }

    final activeTrack = track;
    final libraryController = ref.watch(libraryControllerProvider);
    final libraryState = libraryController.state;
    final currentSong = activeTrack == null ? null : _toSong(activeTrack);
    final artistName = activeTrack?.artist.trim() ?? '';
    final albumName = album?.trim() ?? '';
    // 专辑常常是空的（资料库里显示为「未收录」），标签上要看得出来，
    // 而不是留一对空引号。
    final albumLabel = albumName.isEmpty ? '—' : albumName;

    Future<void> addToPlaylist(String playlistId) async {
      if (currentSong == null) {
        return;
      }
      await ref
          .read(libraryControllerProvider)
          .addToPlaylist(playlistId, currentSong);
      if (!context.mounted) {
        return;
      }
      showToast(context, '已添加到歌单', tone: TuneFreeToastTone.success);
    }

    Future<void> createPlaylistWithCurrentTrack() async {
      final song = currentSong;
      if (song == null) {
        return;
      }
      final playlistName = '${song.name} 收藏';
      final playlist = await ref
          .read(libraryControllerProvider)
          .createPlaylist(playlistName, initialSongs: <Song>[song]);
      if (!context.mounted) {
        return;
      }
      showToast(
        context,
        '已创建歌单「${playlist.name}」',
        tone: TuneFreeToastTone.success,
      );
    }

    /// 收起面板与全屏播放器，切到搜索页并搜这个词。
    ///
    /// 与 Tauri 的两处差别：
    /// - 那边只把关键词塞进输入框（localStorage + nonce），不触发搜索。
    ///   手机上点「搜索歌手」就是想看结果，多一步回车没有意义。
    /// - 那边**不关全屏播放器**，于是搜索页被播放器盖住。这里必须先收起来
    ///   （播放本身不受影响，只是收起界面）。
    ///
    /// 顺序上先跳转再收起：collapse 会把整个全屏播放器从树上摘掉，
    /// 之后就再也拿不到这个 context 去导航了。
    void searchFor(String value, String label) {
      final query = value.trim();
      if (query.isEmpty) {
        showToast(
          context,
          '这首歌没有$label信息，无法搜索',
          tone: TuneFreeToastTone.warning,
        );
        return;
      }

      context.go('/search');
      onClose();
      ref.read(playerControllerProvider.notifier).collapse();

      final searchController = ref.read(searchControllerProvider);
      searchController.updateQuery(query);
      unawaited(searchController.submitSearch());
    }

    Future<void> shareCurrentTrack() async {
      final song = currentSong;
      if (song == null) {
        return;
      }
      final url = _songSourceUrl(song);
      final text = '${song.name} - ${song.artist}';
      final shareText = url != null ? '$text\n$url' : text;
      await SharePlus.instance.share(ShareParams(text: shareText, subject: text));
    }

    return PlayerBottomSheetTransition(
      onClose: onClose,
      child: Container(
        key: const Key('player-more-sheet'),
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.8,
        ),
        decoration: BoxDecoration(
          color: colors.surface,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
        child: SafeArea(
          top: false,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            activeTrack?.title ?? '更多操作',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleLarge
                                ?.copyWith(fontWeight: FontWeight.w700),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            activeTrack?.artist ?? '当前未选择歌曲',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 12,
                              color: colors.textSubtle,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      key: const Key('player-more-close-button'),
                      onPressed: onClose,
                      icon: const Icon(Icons.close_rounded),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                const _SectionHeader(title: '在线播放音质'),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: AudioQuality.values
                      .map(
                        (quality) => _QualityChip(
                          label: quality.shortLabel,
                          isSelected: quality == selectedQuality,
                          onTap: () {
                            unawaited(() async {
                              try {
                                await onSelectQuality(quality);
                                if (!context.mounted) {
                                  return;
                                }
                                showToast(
                                  context,
                                  '已切换为${quality.shortLabel}音质播放',
                                  tone: TuneFreeToastTone.success,
                                );
                              } catch (_) {
                                if (!context.mounted) {
                                  return;
                                }
                                showToast(
                                  context,
                                  '切换${quality.shortLabel}音质失败',
                                  tone: TuneFreeToastTone.error,
                                );
                              }
                            }());
                          },
                          qualityKey: Key(
                            'player-quality-chip-${quality.wireValue}',
                          ),
                        ),
                      )
                      .toList(growable: false),
                ),
                const SizedBox(height: 20),
                const _SectionHeader(title: '快捷操作'),
                const SizedBox(height: 8),
                _ActionTile(
                  actionKey: const Key('player-create-playlist-action'),
                  icon: Icons.add_box_outlined,
                  title: '新建歌单',
                  subtitle: '用当前歌曲快速创建一个资料库歌单',
                  onTap: createPlaylistWithCurrentTrack,
                ),
                const SizedBox(height: 8),
                _ActionTile(
                  actionKey: const Key('player-share-song-action'),
                  icon: Icons.share_outlined,
                  title: '分享歌曲',
                  subtitle: '复制当前歌曲分享文案并显示提示',
                  onTap: shareCurrentTrack,
                ),
                const SizedBox(height: 8),
                _ActionTile(
                  actionKey: const Key('player-search-artist-action'),
                  icon: Icons.person_search_outlined,
                  title: '搜索歌手',
                  subtitle: '在搜索页查找「${artistName.isEmpty ? '—' : artistName}」',
                  onTap: () => searchFor(artistName, '歌手'),
                ),
                const SizedBox(height: 8),
                _ActionTile(
                  actionKey: const Key('player-search-album-action'),
                  icon: Icons.album_outlined,
                  title: '搜索专辑',
                  subtitle: '在搜索页查找「$albumLabel」',
                  onTap: () => searchFor(album ?? '', '专辑'),
                ),
                const SizedBox(height: 20),
                const _SectionHeader(title: '添加到歌单'),
                const SizedBox(height: 8),
                if (libraryState.playlists.isEmpty)
                  const _EmptyStateCard(message: '暂无歌单，可先在资料库中创建')
                else
                  ...libraryState.playlists.map(
                    (playlist) => Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: _PlaylistTile(
                        title: playlist.name,
                        subtitle: '${playlist.songs.length} 首歌曲',
                        isAdded:
                            currentSong != null &&
                            playlist.songs.any(
                              (song) => song.key == currentSong.key,
                            ),
                        onTap: currentSong == null
                            ? null
                            : () => addToPlaylist(playlist.id),
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

  Song _toSong(PlayerTrack playerTrack) {
    return Song(
      id: playerTrack.id,
      name: playerTrack.title,
      artist: playerTrack.artist,
      pic: playerTrack.artworkUrl,
      url: playerTrack.streamUrl,
      source: MusicSource(playerTrack.source),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Text(
      title,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w700,
        color: colors.textTertiary,
      ),
    );
  }
}

class _QualityChip extends StatelessWidget {
  const _QualityChip({
    required this.label,
    required this.isSelected,
    required this.onTap,
    required this.qualityKey,
  });

  final String label;
  final bool isSelected;
  final VoidCallback onTap;
  final Key qualityKey;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: qualityKey,
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Ink(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(
            color: isSelected
                ? colors.textStrong
                : colors.fillSubtle,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: isSelected ? Colors.white : colors.textMuted,
            ),
          ),
        ),
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.actionKey,
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final Key actionKey;
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: actionKey,
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Ink(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: colors.fillFaint,
            borderRadius: BorderRadius.circular(18),
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(
                  color: Colors.white,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: colors.accent, size: 20),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 12,
                        color: colors.textSubtle,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlaylistTile extends StatelessWidget {
  const _PlaylistTile({
    required this.title,
    required this.subtitle,
    required this.isAdded,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final bool isAdded;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Material(
      color: colors.fillFaint,
      borderRadius: BorderRadius.circular(18),
      child: InkWell(
        borderRadius: BorderRadius.circular(18),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(
                Icons.folder_outlined,
                color: colors.accent,
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: TextStyle(
                        fontSize: 12,
                        color: colors.textSubtle,
                      ),
                    ),
                  ],
                ),
              ),
              if (isAdded)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: colors.accentSoft,
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    '已添加',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: colors.accent,
                    ),
                  ),
                )
              else
                Icon(
                  Icons.add_rounded,
                  color: colors.textTertiary,
                  size: 18,
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _EmptyStateCard extends StatelessWidget {
  const _EmptyStateCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: colors.fillFaint,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Text(
        message,
        style: TextStyle(fontSize: 13, color: colors.textSubtle),
      ),
    );
  }
}

String? _songSourceUrl(Song song) {
  switch (song.source.wireValue) {
    case 'netease':
      return 'https://music.163.com/#/song?id=${song.id}';
    case 'qq':
      return 'https://y.qq.com/n/ryqq/songDetail/${song.id}';
    case 'kuwo':
      return 'https://www.kuwo.cn/play_detail/${song.id}';
    default:
      return null;
  }
}
