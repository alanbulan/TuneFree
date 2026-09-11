import 'dart:async';
import 'dart:convert';

import 'package:material_ui/material_ui.dart';
import '../../../shared/theme/tune_free_palette.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:go_router/go_router.dart';
import 'package:open_filex/open_filex.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/build_info.g.dart';
import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';
import '../../../core/network/source_http_client.dart';
import '../../../core/network/tune_free_http_client.dart';
import '../../../core/source_clients/kuwo_client.dart';
import '../../../core/source_clients/netease_client.dart';
import '../../../core/source_clients/qq_client.dart';
import '../../../core/update/app_update_service.dart';
import '../../../shared/theme/tune_free_spacing.dart';
import '../../../shared/widgets/tune_free_feedback.dart';
import '../../player/application/player_controller.dart';
import '../application/library_controller.dart';
import '../application/library_state.dart';
import '../data/playlist_import_repository.dart';
import 'downloads_page.dart';
import 'widgets/appearance_settings_card.dart';
import 'widgets/library_backup_transfer.dart';
import 'widgets/library_playlist_grid.dart';
import 'widgets/library_song_tile.dart';
import 'widgets/library_tab_switcher.dart';
import 'widgets/settings_card.dart';

abstract class AboutLinkLauncher {
  Future<bool> launch(Uri uri);
}

final class UrlLauncherAboutLinkLauncher implements AboutLinkLauncher {
  const UrlLauncherAboutLinkLauncher();

  @override
  Future<bool> launch(Uri uri) {
    return launchUrl(uri, mode: LaunchMode.externalApplication);
  }
}

final aboutLinkLauncherProvider = Provider<AboutLinkLauncher>((ref) {
  return const UrlLauncherAboutLinkLauncher();
});

final appUpdateServiceProvider = Provider<AppUpdateService>((ref) {
  return AppUpdateService(httpClient: TuneFreeHttpClient());
});

final _playlistImportSourceHttpClientProvider = Provider<SourceHttpClient>((
  ref,
) {
  final libraryController = ref.watch(libraryControllerProvider);
  return SourceHttpClient(
    httpClient: TuneFreeHttpClient(),
    corsProxyProvider: () => libraryController.state.corsProxy,
  );
});

final playlistImportClientProvider = Provider<PlaylistImportClient>((ref) {
  final sourceHttpClient = ref.watch(_playlistImportSourceHttpClientProvider);
  final libraryController = ref.watch(libraryControllerProvider);
  return CompositePlaylistImportClient(
    primary: DirectPlaylistImportClient(
      neteaseClient: ReactNeteaseClient(httpClient: sourceHttpClient),
      qqClient: ReactQqClient(httpClient: sourceHttpClient),
      kuwoClient: ReactKuwoClient(
        httpClient: sourceHttpClient,
        corsProxyProvider: () => libraryController.state.corsProxy,
      ),
    ),
    fallback: TunehubPlaylistImportClient(httpClient: TuneFreeHttpClient()),
  );
});

final playlistImportRepositoryProvider = Provider<PlaylistImportRepository>((
  ref,
) {
  return PlaylistImportRepository(
    client: ref.watch(playlistImportClientProvider),
  );
});

final libraryBackupTransferProvider = Provider<LibraryBackupTransfer>((ref) {
  return defaultLibraryBackupTransfer;
});

class LibraryPage extends ConsumerStatefulWidget {
  const LibraryPage({super.key});

  @override
  ConsumerState<LibraryPage> createState() => _LibraryPageState();
}

class _LibraryPageState extends ConsumerState<LibraryPage> {
  String _activeTab = 'favorites';
  String? _previousTab;
  String? _selectedPlaylistId;
  bool _isEditMode = false;
  bool _isImportingPlaylist = false;
  bool _isCheckingUpdate = false;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    final controller = ref.watch(libraryControllerProvider);
    final state = controller.state;
    final selectedPlaylist = _selectedPlaylist(state.playlists);

    if (!state.isLoaded) {
      return Scaffold(
        backgroundColor: colors.fillMuted,
        body: SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }

    return Scaffold(
      backgroundColor: colors.fillMuted,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(
            TuneFreeSpacing.page,
            8,
            TuneFreeSpacing.page,
            TuneFreeSpacing.shellContentBottomPadding,
          ),
          children: [
            const Text(
              '我的资料库',
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 12),
            LibraryTabSwitcher(
              activeTab: _activeTab,
              onChanged: (tab) {
                setState(() {
                  _previousTab = _activeTab;
                  _activeTab = tab;
                  _selectedPlaylistId = null;
                  _isEditMode = false;
                });
              },
            ),
            const SizedBox(height: 12),
            _LibraryTabContentTransition(
              activeTab: _activeTab,
              previousTab: _previousTab,
              child: _buildActiveTab(state, selectedPlaylist, controller),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveTab(
    LibraryState state,
    Playlist? selectedPlaylist,
    LibraryController controller,
  ) {
    return switch (_activeTab) {
      'playlists' when selectedPlaylist == null => _PlaylistsTab(
        key: const ValueKey<String>('library-tab-playlists'),
        playlists: state.playlists,
        onCreatePlaylist: _handleCreatePlaylist,
        onImportPlaylist: _isImportingPlaylist ? null : _handleImportPlaylist,
        onOpenPlaylist: (playlist) {
          setState(() {
            _selectedPlaylistId = playlist.id;
            _isEditMode = false;
          });
        },
      ),
      'playlists' => _PlaylistDetailTab(
        key: const ValueKey<String>('library-tab-playlist-detail'),
        playlist: selectedPlaylist!,
        isEditMode: _isEditMode,
        onBack: () {
          setState(() {
            _selectedPlaylistId = null;
            _isEditMode = false;
          });
        },
        onToggleEditMode: () {
          setState(() {
            _isEditMode = !_isEditMode;
          });
        },
        onRenamePlaylist: () => _handleRenamePlaylist(selectedPlaylist),
        onDeletePlaylist: () => _handleDeletePlaylist(selectedPlaylist),
        onRemoveSong: (song) =>
            _handleRemoveFromPlaylist(selectedPlaylist, song),
        onSongTap: (song) =>
            _playSongQueue(song: song, queueSongs: selectedPlaylist.songs),
      ),
      'manage' => _ManageTab(
        key: const ValueKey<String>('library-tab-manage'),
        state: state,
        controller: controller,
        backupTransfer: ref.watch(libraryBackupTransferProvider),
      ),
      'about' => _AboutTab(
        key: const ValueKey<String>('library-tab-about'),
        linkLauncher: ref.watch(aboutLinkLauncherProvider),
        isCheckingUpdate: _isCheckingUpdate,
        onCheckUpdate: _handleCheckUpdate,
      ),
      _ => _FavoritesTab(
        key: const ValueKey<String>('library-tab-favorites'),
        state: state,
        onSongTap: (song) =>
            _playSongQueue(song: song, queueSongs: state.favorites),
      ),
    };
  }

  Playlist? _selectedPlaylist(List<Playlist> playlists) {
    final selectedId = _selectedPlaylistId;
    if (selectedId == null) {
      return null;
    }
    for (final playlist in playlists) {
      if (playlist.id == selectedId) {
        return playlist;
      }
    }
    return null;
  }

  Future<void> _handleCreatePlaylist() async {
    final name = await _showTextPrompt(
      title: '新建歌单',
      fieldKey: const Key('create-playlist-name-field'),
      confirmKey: const Key('confirm-create-playlist-button'),
      confirmLabel: '创建',
      hintText: '输入歌单名称',
    );
    if (name == null) {
      return;
    }

    await ref.read(libraryControllerProvider).createPlaylist(name);
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('已创建歌单「$name」')));
  }

  Future<void> _handleImportPlaylist() async {
    if (_isImportingPlaylist) {
      return;
    }
    final input = await _showImportPlaylistDialog();
    if (input == null) {
      return;
    }

    setState(() {
      _isImportingPlaylist = true;
    });
    _showImportProgressDialog();
    await Future<void>.delayed(Duration.zero);

    try {
      final result = await ref
          .read(playlistImportRepositoryProvider)
          .importPlaylist(source: input.$1, id: input.$2);
      final playlist = await ref
          .read(libraryControllerProvider)
          .createPlaylist(result.$1, initialSongs: result.$2);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('成功导入歌单「${playlist.name}」')));
    } on PlaylistImportException catch (error) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_importErrorMessage(error))));
    } catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导入失败，请稍后重试')));
    } finally {
      if (mounted) {
        final navigator = Navigator.of(context, rootNavigator: true);
        if (navigator.canPop()) {
          navigator.pop();
        }
        setState(() {
          _isImportingPlaylist = false;
        });
      }
    }
  }

  Future<void> _handleRenamePlaylist(Playlist playlist) async {
    final name = await _showTextPrompt(
      title: '重命名歌单',
      fieldKey: const Key('rename-playlist-name-field'),
      confirmKey: const Key('confirm-rename-playlist-button'),
      confirmLabel: '保存',
      hintText: '输入新的歌单名称',
      initialValue: playlist.name,
    );
    if (name == null) {
      return;
    }

    await ref.read(libraryControllerProvider).renamePlaylist(playlist.id, name);
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('已重命名为「$name」')));
  }

  Future<void> _handleDeletePlaylist(Playlist playlist) async {
    final shouldDelete =
        await showDialog<bool>(
          context: context,
          builder: (dialogContext) {
            return AlertDialog(
              title: const Text('删除歌单'),
              content: Text('确定删除「${playlist.name}」吗？'),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(false),
                  child: const Text('取消'),
                ),
                FilledButton(
                  key: const Key('confirm-delete-playlist-button'),
                  onPressed: () => Navigator.of(dialogContext).pop(true),
                  style: FilledButton.styleFrom(
                    backgroundColor: TuneFreeColors.of(dialogContext).accent,
                  ),
                  child: const Text('删除'),
                ),
              ],
            );
          },
        ) ??
        false;
    if (!shouldDelete) {
      return;
    }

    final library = ref.read(libraryControllerProvider);
    // 快照要在删除**之前**取：restorePlaylist 靠它把 id 和顺序原样放回去。
    final snapshot = playlist;
    final snapshotIndex = library.state.playlists.indexWhere(
      (item) => item.id == playlist.id,
    );
    await library.deletePlaylist(playlist.id);
    if (!mounted) {
      return;
    }
    setState(() {
      _selectedPlaylistId = null;
      _isEditMode = false;
    });
    showUndoToast(
      context,
      '已删除歌单「${snapshot.name}」',
      tone: TuneFreeToastTone.warning,
      onUndo: () => library.restorePlaylist(
        snapshot,
        index: snapshotIndex < 0 ? 0 : snapshotIndex,
      ),
    );
  }

  Future<void> _handleRemoveFromPlaylist(Playlist playlist, Song song) async {
    final library = ref.read(libraryControllerProvider);
    final snapshot = playlist;
    await library.removeFromPlaylist(playlist.id, song);
    if (!mounted) {
      return;
    }
    showUndoToast(
      context,
      '已从歌单移除「${song.name}」',
      onUndo: () => library.restorePlaylist(snapshot),
    );
  }

  Future<void> _playSongQueue({
    required Song song,
    required List<Song> queueSongs,
  }) async {
    await ref
        .read(playerControllerProvider.notifier)
        .playSong(song, queue: List<Song>.unmodifiable(queueSongs));
  }

  Future<void> _handleCheckUpdate() async {
    if (_isCheckingUpdate) {
      return;
    }

    setState(() {
      _isCheckingUpdate = true;
    });

    try {
      final updateInfo = await ref
          .read(appUpdateServiceProvider)
          .checkForUpdate();
      if (!mounted) {
        return;
      }

      if (!updateInfo.hasUpdate) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('已是最新版本 v${updateInfo.currentVersion}')),
        );
        return;
      }

      final shouldOpen =
          await showDialog<bool>(
            context: context,
            builder: (dialogContext) {
              return AlertDialog(
                title: const Text('发现新版本'),
                content: Text(
                  '当前版本：v${updateInfo.currentVersion}\n'
                  '最新版本：v${updateInfo.latestVersion}\n\n'
                  '${updateInfo.releaseName}',
                ),
                actions: [
                  TextButton(
                    onPressed: () => Navigator.of(dialogContext).pop(false),
                    child: const Text('稍后'),
                  ),
                  FilledButton(
                    key: const Key('confirm-open-update-button'),
                    onPressed: () => Navigator.of(dialogContext).pop(true),
                    style: FilledButton.styleFrom(
                      backgroundColor: TuneFreeColors.of(dialogContext).accent,
                    ),
                    child: const Text('去更新'),
                  ),
                ],
              );
            },
          ) ??
          false;
      if (!mounted || !shouldOpen) {
        return;
      }

      await _downloadAndInstall(updateInfo.downloadUri);
    } on AppUpdateException catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('检查更新失败，请稍后重试')));
    } catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('检查更新失败，请稍后重试')));
    } finally {
      if (mounted) {
        setState(() {
          _isCheckingUpdate = false;
        });
      }
    }
  }

  Future<void> _downloadAndInstall(Uri downloadUri) async {
    final progressNotifier = ValueNotifier<double>(0);

    if (!mounted) return;
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return ValueListenableBuilder<double>(
          valueListenable: progressNotifier,
          builder: (context, progress, _) {
            return AlertDialog(
              title: const Text('正在下载更新'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  LinearProgressIndicator(
                    value: progress > 0 ? progress : null,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '${(progress * 100).toStringAsFixed(0)}%',
                    style: const TextStyle(fontSize: 13),
                  ),
                ],
              ),
            );
          },
        );
      },
    );

    try {
      final updateService = ref.read(appUpdateServiceProvider);
      final filePath = await updateService.downloadApk(downloadUri.toString(), (
        received,
        total,
      ) {
        if (total > 0) {
          progressNotifier.value = received / total;
        }
      });

      if (!mounted) return;
      Navigator.of(context).pop(); // close progress dialog

      final result = await OpenFilex.open(filePath);
      if (result.type != ResultType.done) {
        if (!mounted) return;
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('无法打开安装包，请手动安装')));
        await ref.read(aboutLinkLauncherProvider).launch(downloadUri);
      }
    } catch (_) {
      if (!mounted) return;
      Navigator.of(context).pop(); // close progress dialog
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('下载失败，正在跳转浏览器...')));
      await ref.read(aboutLinkLauncherProvider).launch(downloadUri);
    }
  }

  void _showImportProgressDialog() {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        return const AlertDialog(
          content: Row(
            children: [
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2.4),
              ),
              SizedBox(width: 16),
              Expanded(child: Text('正在导入歌单…')),
            ],
          ),
        );
      },
    );
  }

  String _importErrorMessage(PlaylistImportException error) {
    return switch (error.code) {
      PlaylistImportErrorCode.invalidInput => '无法识别歌单链接，请检查后重试',
      PlaylistImportErrorCode.sourceMismatch => '音源和歌单链接不匹配，请重新选择',
      PlaylistImportErrorCode.unsupportedSource => '暂不支持该音源歌单导入',
      PlaylistImportErrorCode.emptyPlaylist => '未找到可导入歌曲，请确认歌单是否公开',
      PlaylistImportErrorCode.network ||
      PlaylistImportErrorCode.remoteFormat => '导入失败，请稍后重试或更换网络',
    };
  }

  Future<String?> _showTextPrompt({
    required String title,
    required Key fieldKey,
    required Key confirmKey,
    required String confirmLabel,
    required String hintText,
    String initialValue = '',
  }) async {
    var value = initialValue;
    return showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(title),
          content: TextFormField(
            key: fieldKey,
            initialValue: initialValue,
            autofocus: true,
            decoration: InputDecoration(hintText: hintText),
            onChanged: (nextValue) {
              value = nextValue;
            },
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('取消'),
            ),
            FilledButton(
              key: confirmKey,
              onPressed: () {
                final trimmedValue = value.trim();
                if (trimmedValue.isEmpty) {
                  return;
                }
                Navigator.of(dialogContext).pop(trimmedValue);
              },
              style: FilledButton.styleFrom(
                backgroundColor: TuneFreeColors.of(dialogContext).accent,
              ),
              child: Text(confirmLabel),
            ),
          ],
        );
      },
    );
  }

  Future<(String, String)?> _showImportPlaylistDialog() async {
    var source = 'netease';
    var id = '';
    return showDialog<(String, String)>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (context, setDialogState) {
            return AlertDialog(
              title: const Text('导入在线歌单'),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  DropdownButtonFormField<String>(
                    key: const Key('import-playlist-source-field'),
                    initialValue: source,
                    decoration: const InputDecoration(labelText: '音源'),
                    items: const [
                      DropdownMenuItem(value: 'netease', child: Text('网易云')),
                      DropdownMenuItem(value: 'qq', child: Text('QQ 音乐')),
                      DropdownMenuItem(value: 'kuwo', child: Text('酷我音乐')),
                    ],
                    onChanged: (value) {
                      if (value == null) {
                        return;
                      }
                      setDialogState(() {
                        source = value;
                      });
                    },
                  ),
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const Key('import-playlist-id-field'),
                    autofocus: true,
                    decoration: const InputDecoration(
                      hintText: '粘贴歌单链接或输入 ID',
                      helperText: '支持网易云、QQ 音乐、酷我歌单链接',
                    ),
                    onChanged: (nextValue) {
                      id = nextValue;
                    },
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('取消'),
                ),
                FilledButton(
                  key: const Key('confirm-import-playlist-button'),
                  onPressed: () {
                    final trimmedId = id.trim();
                    if (trimmedId.isEmpty) {
                      return;
                    }
                    Navigator.of(dialogContext).pop((source, trimmedId));
                  },
                  style: FilledButton.styleFrom(
                    backgroundColor: TuneFreeColors.of(dialogContext).accent,
                  ),
                  child: const Text('导入'),
                ),
              ],
            );
          },
        );
      },
    );
  }
}

class _LibraryTabContentTransition extends StatelessWidget {
  const _LibraryTabContentTransition({
    required this.activeTab,
    required this.previousTab,
    required this.child,
  });

  final String activeTab;
  final String? previousTab;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final previousIndex = _tabIndex(previousTab ?? activeTab);
    final activeIndex = _tabIndex(activeTab);
    final direction = activeIndex >= previousIndex ? 1.0 : -1.0;

    return ClipRect(
      child: AnimatedSwitcher(
        duration: const Duration(milliseconds: 300),
        reverseDuration: const Duration(milliseconds: 220),
        switchInCurve: Curves.easeOutCubic,
        switchOutCurve: Curves.easeInCubic,
        layoutBuilder: (currentChild, previousChildren) {
          return Stack(
            alignment: Alignment.topCenter,
            children: [...previousChildren, ?currentChild],
          );
        },
        transitionBuilder: (child, animation) {
          final curvedAnimation = CurvedAnimation(
            parent: animation,
            curve: Curves.easeOutCubic,
            reverseCurve: Curves.easeInCubic,
          );
          final offset = Tween<Offset>(
            begin: Offset(0.055 * direction, 0),
            end: Offset.zero,
          ).animate(curvedAnimation);
          final scale = Tween<double>(
            begin: 0.985,
            end: 1,
          ).animate(curvedAnimation);
          return IgnorePointer(
            ignoring: animation.status == AnimationStatus.reverse,
            child: FadeTransition(
              opacity: curvedAnimation,
              child: SlideTransition(
                position: offset,
                child: ScaleTransition(
                  scale: scale,
                  child: RepaintBoundary(child: child),
                ),
              ),
            ),
          );
        },
        child: child,
      ),
    );
  }

  static int _tabIndex(String tab) {
    final index = LibraryTabSwitcher.tabs.indexOf(tab);
    return index < 0 ? 0 : index;
  }
}

class _FavoritesTab extends StatelessWidget {
  const _FavoritesTab({
    super.key,
    required this.state,
    required this.onSongTap,
  });

  final LibraryState state;
  final ValueChanged<Song> onSongTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.favorite_rounded, color: colors.accent, size: 20),
            const SizedBox(width: 8),
            Text(
              '我喜欢的音乐 (${state.favorites.length})',
              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
            ),
          ],
        ),
        const SizedBox(height: 12),
        if (state.favorites.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 36),
            child: Center(
              child: Text(
                '暂无歌曲',
                style: TextStyle(fontSize: 14, color: colors.textTertiary),
              ),
            ),
          )
        else
          ...state.favorites.map(
            (song) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: LibrarySongTile(song: song, onTap: () => onSongTap(song)),
            ),
          ),
      ],
    );
  }
}

class _PlaylistsTab extends StatelessWidget {
  const _PlaylistsTab({
    super.key,
    required this.playlists,
    required this.onCreatePlaylist,
    required this.onImportPlaylist,
    required this.onOpenPlaylist,
  });

  final List<Playlist> playlists;
  final Future<void> Function() onCreatePlaylist;
  final Future<void> Function()? onImportPlaylist;
  final ValueChanged<Playlist> onOpenPlaylist;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _ActionPlaylistCard(
                cardKey: const Key('create-playlist-action'),
                icon: Icons.add_rounded,
                label: '新建歌单',
                borderColor: colors.borderSubtle,
                foregroundColor: colors.textTertiary,
                onTap: onCreatePlaylist,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _ActionPlaylistCard(
                cardKey: const Key('import-playlist-action'),
                icon: Icons.download_rounded,
                label: '导入在线歌单',
                borderColor: colors.accentSoft,
                foregroundColor: colors.accent,
                onTap: onImportPlaylist,
              ),
            ),
          ],
        ),
        if (playlists.isNotEmpty) ...[
          const SizedBox(height: 12),
          LibraryPlaylistGrid(playlists: playlists, onTap: onOpenPlaylist),
        ],
      ],
    );
  }
}

class _ActionPlaylistCard extends StatelessWidget {
  const _ActionPlaylistCard({
    required this.cardKey,
    required this.icon,
    required this.label,
    required this.borderColor,
    required this.foregroundColor,
    required this.onTap,
  });

  final Key cardKey;
  final IconData icon;
  final String label;
  final Color borderColor;
  final Color foregroundColor;
  final Future<void> Function()? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: cardKey,
      onTap: onTap,
      child: Opacity(
        opacity: onTap == null ? 0.55 : 1,
        child: Container(
          height: 132,
          decoration: BoxDecoration(
            color: TuneFreeColors.of(context).surface,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: borderColor, width: 2),
          ),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, size: 28, color: foregroundColor),
              const SizedBox(height: 6),
              Text(
                label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: foregroundColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PlaylistDetailTab extends StatefulWidget {
  const _PlaylistDetailTab({
    super.key,
    required this.playlist,
    required this.isEditMode,
    required this.onBack,
    required this.onToggleEditMode,
    required this.onRenamePlaylist,
    required this.onDeletePlaylist,
    required this.onRemoveSong,
    required this.onSongTap,
  });

  final Playlist playlist;
  final bool isEditMode;
  final VoidCallback onBack;
  final VoidCallback onToggleEditMode;
  final Future<void> Function() onRenamePlaylist;
  final Future<void> Function() onDeletePlaylist;
  final ValueChanged<Song> onRemoveSong;
  final ValueChanged<Song> onSongTap;

  @override
  State<_PlaylistDetailTab> createState() => _PlaylistDetailTabState();
}

class _PlaylistDetailTabState extends State<_PlaylistDetailTab> {
  static const _pageSize = 20;
  int _displayCount = _pageSize;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    final playlist = widget.playlist;
    final isEditMode = widget.isEditMode;
    final totalSongs = playlist.songs.length;
    final visibleSongs = playlist.songs.take(_displayCount).toList();
    final hasMore = _displayCount < totalSongs;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          onPressed: widget.onBack,
          icon: Icon(Icons.arrow_back_rounded, color: colors.accent),
          label: Text(
            '返回歌单列表',
            style: TextStyle(color: colors.accent, fontWeight: FontWeight.w600),
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: TuneFreeColors.of(context).surface,
            borderRadius: BorderRadius.circular(20),
          ),
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
                          playlist.name,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '$totalSongs 首歌曲',
                          style: TextStyle(
                            fontSize: 12,
                            color: colors.textSubtle,
                          ),
                        ),
                      ],
                    ),
                  ),
                  FilledButton.tonal(
                    key: const Key('playlist-edit-mode-button'),
                    onPressed: widget.onToggleEditMode,
                    style: FilledButton.styleFrom(
                      backgroundColor: isEditMode
                          ? colors.accent
                          : colors.fillSubtle,
                      foregroundColor: isEditMode
                          ? Colors.white
                          : colors.accent,
                    ),
                    child: Text(isEditMode ? '完成' : '编辑'),
                  ),
                ],
              ),
              if (isEditMode) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('playlist-rename-button'),
                        onPressed: widget.onRenamePlaylist,
                        child: const Text('重命名'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.tonal(
                        key: const Key('playlist-delete-button'),
                        onPressed: widget.onDeletePlaylist,
                        style: FilledButton.styleFrom(
                          backgroundColor: colors.accentSoft,
                          foregroundColor: colors.accent,
                        ),
                        child: const Text('删除歌单'),
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: 12),
        if (playlist.songs.isEmpty)
          Padding(
            padding: EdgeInsets.symmetric(vertical: 36),
            child: Center(
              child: Text(
                '暂无歌曲',
                style: TextStyle(fontSize: 14, color: colors.textTertiary),
              ),
            ),
          )
        else ...[
          ...visibleSongs.map(
            (song) => Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: LibrarySongTile(
                song: song,
                onTap: () => widget.onSongTap(song),
                trailing: isEditMode
                    ? IconButton(
                        key: Key('playlist-remove-song-${song.key}'),
                        onPressed: () => widget.onRemoveSong(song),
                        icon: Icon(
                          Icons.delete_outline_rounded,
                          color: colors.accent,
                        ),
                      )
                    : null,
              ),
            ),
          ),
          if (hasMore)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Center(
                child: TextButton(
                  onPressed: () => setState(() {
                    _displayCount += _pageSize;
                  }),
                  child: Text(
                    '加载更多 (${totalSongs - _displayCount} 首剩余)',
                    style: TextStyle(color: colors.accent, fontSize: 13),
                  ),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

class _ManageTab extends StatefulWidget {
  const _ManageTab({
    super.key,
    required this.state,
    required this.controller,
    required this.backupTransfer,
  });

  final LibraryState state;
  final LibraryController controller;
  final LibraryBackupTransfer backupTransfer;

  @override
  State<_ManageTab> createState() => _ManageTabState();
}

class _ManageTabState extends State<_ManageTab> {
  late final TextEditingController _proxyController;

  /// 导出/导入进行中。Android 上系统分享面板与 SAF 文件选择器可能停留很久，
  /// 没有忙碌态用户会以为按钮没反应而反复点。web 上是瞬时的，所以以前没暴露出来。
  bool _isExportingJson = false;
  bool _isImportingJson = false;

  @override
  void initState() {
    super.initState();
    _proxyController = TextEditingController(text: widget.state.corsProxy);
  }

  @override
  void didUpdateWidget(covariant _ManageTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state.corsProxy != widget.state.corsProxy) {
      _proxyController.text = widget.state.corsProxy;
    }
  }

  void _openDownloadsPage() {
    try {
      unawaited(context.push('/library/downloads'));
    } catch (_) {
      unawaited(
        Navigator.of(context).push(
          MaterialPageRoute<void>(
            settings: const RouteSettings(name: '/library/downloads'),
            builder: (_) => const LibraryDownloadsPage(),
          ),
        ),
      );
    }
  }

  @override
  void dispose() {
    _proxyController.dispose();
    super.dispose();
  }

  Future<void> _handleExportJson(BuildContext context) async {
    if (_isExportingJson) {
      return;
    }
    setState(() => _isExportingJson = true);
    try {
      final jsonText = await widget.controller.exportBackupJson();
      final fileName = _buildBackupFileName();
      await widget.backupTransfer.downloadJsonFile(
        fileName: fileName,
        content: jsonText,
      );
      // 文件真的交出去之后才记「最近导出」，失败时不该留下这张卡。
      widget.controller.markBackupExported(jsonText);
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('备份文件已下载')));
    } on UnsupportedError catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('当前平台暂不支持导出备份文件')));
    } catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导出失败，请稍后重试')));
    } finally {
      if (mounted) {
        setState(() => _isExportingJson = false);
      }
    }
  }

  Future<void> _handleImportJson(BuildContext context) async {
    if (_isImportingJson) {
      return;
    }
    final fileBytes = await _pickImportFile(context);
    if (fileBytes == null || !context.mounted) {
      return;
    }

    final String rawJson;
    try {
      rawJson = utf8.decode(fileBytes);
      // 导入是整体替换，先让用户看清「当前有什么 / 文件里有什么」再动手。
      final incoming = _countBackupEntries(rawJson);
      // 确认框期间刻意不显示忙碌态：此刻是用户在思考，不是我们在干活。
      // 一直转圈还会让测试里的 pumpAndSettle 永远等不到静止。
      final confirmed = await _confirmImport(context, incoming);
      if (!confirmed || !context.mounted) {
        return;
      }
    } on FormatException catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导入失败，请检查 JSON 文件格式')));
      return;
    }

    // 真正开始替换资料库了，这时才置忙碌。
    setState(() => _isImportingJson = true);
    try {
      final previous = await widget.controller.importBackupJson(rawJson);
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('备份数据已导入'),
          action: SnackBarAction(
            label: '撤销',
            onPressed: () => widget.controller.restoreBackup(previous),
          ),
        ),
      );
    } catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导入失败，请稍后重试')));
    } finally {
      if (mounted) {
        setState(() => _isImportingJson = false);
      }
    }
  }

  /// 选文件阶段。Android 的 SAF 选择器可能停留很久，所以这一小段要有忙碌态。
  Future<List<int>?> _pickImportFile(BuildContext context) async {
    setState(() => _isImportingJson = true);
    try {
      return await widget.backupTransfer.pickJsonFileBytes();
    } on UnsupportedError catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('当前平台暂不支持导入备份文件')));
      }
      return null;
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('导入失败，请稍后重试')));
      }
      return null;
    } finally {
      if (mounted) {
        setState(() => _isImportingJson = false);
      }
    }
  }

  /// 只取条数，用于导入确认 —— 不解析成完整模型，避免在选择阶段就产生副作用。
  ({int favorites, int playlists}) _countBackupEntries(String jsonText) {
    final decoded = jsonDecode(jsonText) as Map<String, dynamic>;
    return (
      favorites:
          (decoded['favorites'] as List<dynamic>? ?? const <dynamic>[]).length,
      playlists:
          (decoded['playlists'] as List<dynamic>? ?? const <dynamic>[]).length,
    );
  }

  Future<bool> _confirmImport(
    BuildContext context,
    ({int favorites, int playlists}) incoming,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        key: const Key('import-backup-confirm-dialog'),
        title: const Text('覆盖导入备份'),
        content: Text(
          '当前：${widget.state.favorites.length} 首收藏 / '
          '${widget.state.playlists.length} 个歌单\n'
          '文件：${incoming.favorites} 首收藏 / ${incoming.playlists} 个歌单\n\n'
          '覆盖导入会替换当前收藏和歌单，导入后可通过提示条撤销。是否继续？',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('取消'),
          ),
          FilledButton(
            key: const Key('confirm-import-backup-button'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('覆盖导入'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  String _buildBackupFileName() {
    final date = DateTime.now().toIso8601String().split('T').first;
    return 'tunefree_backup_$date.json';
  }

  List<String> _buildPreviewLines(String jsonText) {
    final decoded = jsonDecode(jsonText) as Map<String, dynamic>;
    final favorites =
        (decoded['favorites'] as List<dynamic>? ?? const <dynamic>[])
            .map(
              (item) =>
                  (item as Map<String, dynamic>)['name'] as String? ?? '未命名歌曲',
            )
            .take(2)
            .toList(growable: false);
    final playlists =
        (decoded['playlists'] as List<dynamic>? ?? const <dynamic>[])
            .map(
              (item) =>
                  (item as Map<String, dynamic>)['name'] as String? ?? '未命名歌单',
            )
            .take(2)
            .toList(growable: false);

    return <String>[
      '收藏 ${favorites.length} 首：${favorites.join('、')}',
      '歌单 ${playlists.length} 个：${playlists.join('、')}',
    ];
  }

  List<String> _buildImportedPreviewLines() {
    return <String>[
      '收藏：${widget.state.favorites.take(2).map((song) => song.name).join('、')}',
      '歌单：${widget.state.playlists.take(2).map((playlist) => playlist.name).join('、')}',
    ];
  }

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Column(
      children: [
        const AppearanceSettingsCard(),
        const SizedBox(height: 14),
        SettingsCard(
          title: '网络设置',
          icon: Icons.settings_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SettingsField(
                label: 'CORS 代理 (可选)',
                controller: _proxyController,
                hintText: '留空使用内置代理（推荐）',
              ),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: () async {
                  await widget.controller.setCorsProxy(_proxyController.text);
                  if (!context.mounted) {
                    return;
                  }
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(const SnackBar(content: Text('设置已保存')));
                },
                style: FilledButton.styleFrom(
                  backgroundColor: colors.accent,
                  minimumSize: const Size(double.infinity, 48),
                ),
                child: const Text('保存配置'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SettingsCard(
          title: '下载管理',
          icon: Icons.download_done_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                widget.state.downloads.isEmpty
                    ? '暂无离线条目，下载后会自动出现在独立页面。'
                    : '当前保存了 ${widget.state.downloads.length} 个离线条目。',
                style: TextStyle(
                  fontSize: 14,
                  color: colors.textMuted,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 6),
              Text(
                '播放时会优先使用本地文件。',
                style: TextStyle(
                  fontSize: 12,
                  color: colors.textTertiary,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 12),
              FilledButton(
                key: const Key('library-downloads-management-button'),
                onPressed: _openDownloadsPage,
                style: FilledButton.styleFrom(
                  backgroundColor: colors.accent,
                  minimumSize: const Size(double.infinity, 48),
                ),
                child: const Text('打开下载管理'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        SettingsCard(
          title: '数据备份',
          icon: Icons.upload_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: _SecondaryActionButton(
                      buttonKey: const Key('library-export-json-button'),
                      label: '导出 JSON',
                      busy: _isExportingJson,
                      onTap: () => _handleExportJson(context),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _SecondaryActionButton(
                      buttonKey: const Key('library-import-data-button'),
                      label: '导入数据',
                      semanticsLabel: '选择备份文件导入数据',
                      busy: _isImportingJson,
                      onTap: () => _handleImportJson(context),
                    ),
                  ),
                ],
              ),
              if (widget.state.exportedBackupJson case final exportedJson?) ...[
                const SizedBox(height: 12),
                _BackupPreviewCard(
                  title: '最近导出',
                  previewLines: _buildPreviewLines(exportedJson),
                ),
              ],
              if (widget.state.lastImportSummary case final importSummary?) ...[
                const SizedBox(height: 12),
                _BackupPreviewCard(
                  title: importSummary,
                  previewLines: _buildImportedPreviewLines(),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SettingsField extends StatelessWidget {
  const _SettingsField({
    required this.label,
    required this.controller,
    required this.hintText,
  });

  final String label;
  final TextEditingController controller;
  final String hintText;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: colors.textTertiary,
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          decoration: InputDecoration(
            hintText: hintText,
            filled: true,
            fillColor: colors.fillFaint,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: BorderSide(color: colors.borderSubtle),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: BorderSide(color: colors.borderSubtle),
            ),
          ),
        ),
      ],
    );
  }
}

class _SecondaryActionButton extends StatelessWidget {
  const _SecondaryActionButton({
    required this.buttonKey,
    required this.label,
    required this.onTap,
    this.semanticsLabel,
    this.busy = false,
  });

  final Key buttonKey;
  final String label;
  final VoidCallback onTap;
  final String? semanticsLabel;

  /// 进行中：按钮置灰并显示转圈，避免重复触发。
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Semantics(
      label: semanticsLabel,
      button: true,
      child: FilledButton.tonal(
        key: buttonKey,
        // 传 null 即进入禁用态，FilledButton 会自己处理置灰。
        onPressed: busy ? null : onTap,
        style: FilledButton.styleFrom(
          minimumSize: const Size(double.infinity, 44),
          backgroundColor: colors.fillSubtle,
          foregroundColor: colors.textStrong,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: busy
            ? const SizedBox(
                width: 16,
                height: 16,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                ),
              ),
      ),
    );
  }
}

class _BackupPreviewCard extends StatelessWidget {
  const _BackupPreviewCard({required this.title, required this.previewLines});

  final String title;
  final List<String> previewLines;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.fillFaint,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 8),
          ...previewLines.map(
            (line) => Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                line,
                style: TextStyle(fontSize: 12, color: colors.textMuted),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AboutTab extends StatelessWidget {
  const _AboutTab({
    super.key,
    required this.linkLauncher,
    required this.isCheckingUpdate,
    required this.onCheckUpdate,
  });

  final AboutLinkLauncher linkLauncher;
  final bool isCheckingUpdate;
  final Future<void> Function() onCheckUpdate;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _AboutCard(
          padding: const EdgeInsets.all(18),
          child: Column(
            children: [
              const _AboutAppIcon(),
              const SizedBox(height: 12),
              const Text(
                'TuneFree Mobile',
                style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 4),
              Text(
                '一个高颜值的 Flutter Android 音乐播放器',
                style: TextStyle(fontSize: 13, color: colors.textMuted),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              _VersionUpdateBadge(
                isCheckingUpdate: isCheckingUpdate,
                onCheckUpdate: onCheckUpdate,
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        const _AboutCard(
          title: '功能特性',
          child: Column(
            children: [
              _FeatureRow(
                index: '1',
                title: '多源聚合搜索',
                subtitle: '支持网易云、QQ音乐、酷我音乐，以及 JOOX 扩展音源',
              ),
              SizedBox(height: 10),
              _FeatureRow(
                index: '2',
                title: '无损音质播放',
                subtitle: '支持 128k / 320k / FLAC / Hi-Res',
              ),
              SizedBox(height: 10),
              _FeatureRow(
                index: '3',
                title: '实时音频可视化',
                subtitle: 'Android 原生频谱数据驱动 Flutter 播放动效',
              ),
              SizedBox(height: 10),
              _FeatureRow(index: '4', title: '逐行滚动歌词', subtitle: '支持双语歌词翻译显示'),
              SizedBox(height: 10),
              _FeatureRow(
                index: '5',
                title: 'Android 离线体验',
                subtitle: '下载到本地，优先使用离线音频播放',
              ),
            ],
          ),
        ),
        const SizedBox(height: 14),
        // 版本号来自 tool/generate_build_info.dart 生成的 kTechStack，
        // 不再手写 —— 手写的话每次升级依赖这里就过期了。
        _AboutCard(
          title: '技术栈',
          child: Column(
            children: <Widget>[
              for (final entry in kTechStack) _TechStackRow(entry: entry),
            ],
          ),
        ),
        const SizedBox(height: 14),
        _AboutCard(
          title: '后端 API',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '网易云、QQ音乐、酷我音乐使用直连接口；JOOX 扩展音源与播放解析由 GD音乐台 (music.gdstudio.xyz) 提供。',
                style: TextStyle(
                  fontSize: 14,
                  color: colors.textMuted,
                  height: 1.5,
                ),
              ),
              SizedBox(height: 8),
              Text(
                '播放地址、歌词和封面通过 music-api.gdstudio.xyz/api.php 解析。GD 音乐台为公开接口，建议控制请求频率：5 分钟内不超过 50 次请求。',
                style: TextStyle(
                  fontSize: 12,
                  color: colors.textTertiary,
                  height: 1.5,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        _AboutCard(
          title: '链接',
          child: Column(
            children: [
              _LinkRow(
                title: 'GD音乐台',
                subtitle: 'music.gdstudio.xyz',
                uri: Uri.parse('https://music.gdstudio.xyz/'),
                linkLauncher: linkLauncher,
              ),
              const SizedBox(height: 12),
              _LinkRow(
                title: '在线演示',
                subtitle: 'music.alanbulan.space',
                uri: Uri.parse('https://music.alanbulan.space'),
                linkLauncher: linkLauncher,
              ),
              const SizedBox(height: 12),
              _LinkRow(
                title: 'GitHub 仓库',
                subtitle: 'alanbulan/TuneFree_Mobile',
                uri: Uri.parse('https://github.com/alanbulan/TuneFree_Mobile'),
                linkLauncher: linkLauncher,
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        const _DisclaimerCard(),
      ],
    );
  }
}

class _AboutCard extends StatelessWidget {
  const _AboutCard({this.title, required this.child, this.padding});

  final String? title;
  final Widget child;
  final EdgeInsetsGeometry? padding;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: TuneFreeColors.of(context).surface,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 10),
          ],
          child,
        ],
      ),
    );
  }
}

class _AboutAppIcon extends StatelessWidget {
  const _AboutAppIcon();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      width: 50,
      height: 50,
      decoration: BoxDecoration(
        color: colors.accentSoft,
        borderRadius: BorderRadius.circular(18),
      ),
      child: Icon(Icons.music_note_rounded, size: 26, color: colors.accent),
    );
  }
}

class _VersionUpdateBadge extends StatelessWidget {
  const _VersionUpdateBadge({
    required this.isCheckingUpdate,
    required this.onCheckUpdate,
  });

  final bool isCheckingUpdate;
  final Future<void> Function() onCheckUpdate;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Wrap(
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      runSpacing: 6,
      children: [
        FutureBuilder<PackageInfo>(
          future: PackageInfo.fromPlatform(),
          builder: (context, snapshot) {
            final version = snapshot.data?.version ?? '...';
            return Text(
              'v$version',
              style: TextStyle(fontSize: 11, color: colors.textTertiary),
            );
          },
        ),
        InkWell(
          key: const Key('about-check-update-button'),
          borderRadius: BorderRadius.circular(999),
          onTap: isCheckingUpdate ? null : () => unawaited(onCheckUpdate()),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: colors.accentSoft,
              borderRadius: BorderRadius.circular(999),
              border: Border.all(color: colors.accentSoft),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.system_update_alt_rounded,
                  size: 13,
                  color: isCheckingUpdate ? colors.textTertiary : colors.accent,
                ),
                const SizedBox(width: 4),
                Text(
                  isCheckingUpdate ? '检查中' : '更新',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: isCheckingUpdate
                        ? colors.textTertiary
                        : colors.accent,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _FeatureRow extends StatelessWidget {
  const _FeatureRow({
    required this.index,
    required this.title,
    required this.subtitle,
  });

  final String index;
  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          index,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: colors.accent,
          ),
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
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 1),
              Text(
                subtitle,
                style: TextStyle(
                  fontSize: 11,
                  color: colors.textTertiary,
                  height: 1.35,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TechStackRow extends StatelessWidget {
  const _TechStackRow({required this.entry});

  final TechStackEntry entry;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        children: [
          Expanded(
            child: Row(
              children: [
                Text(
                  entry.name,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: colors.textStrong,
                  ),
                ),
                const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    entry.detail,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, color: colors.textTertiary),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            entry.version,
            style: TextStyle(fontSize: 11, color: colors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _LinkRow extends StatelessWidget {
  const _LinkRow({
    required this.title,
    required this.subtitle,
    required this.uri,
    required this.linkLauncher,
  });

  final String title;
  final String subtitle;
  final Uri uri;
  final AboutLinkLauncher linkLauncher;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: Key('about-link-$title'),
        borderRadius: BorderRadius.circular(14),
        onTap: () => linkLauncher.launch(uri),
        child: Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: colors.fillFaint,
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Icon(Icons.open_in_new_rounded, size: 16, color: colors.accent),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                subtitle,
                style: TextStyle(fontSize: 11, color: colors.textTertiary),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DisclaimerCard extends StatelessWidget {
  const _DisclaimerCard();

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: colors.fillFaint,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        children: [
          Text(
            '本项目仅供学习 Flutter 与移动端音乐播放器实现使用。音乐资源来源于第三方 API，请支持正版音乐。',
            style: TextStyle(
              fontSize: 11,
              color: colors.textTertiary,
              height: 1.6,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: 8),
          Text(
            'MIT License © 2026 TuneFree',
            style: TextStyle(fontSize: 11, color: colors.textTertiary),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
