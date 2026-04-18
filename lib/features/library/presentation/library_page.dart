import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../core/network/tune_free_http_client.dart';
import '../../../core/models/playlist.dart';
import '../../../core/models/song.dart';
import '../../player/application/player_controller.dart';
import '../application/library_controller.dart';
import '../application/library_state.dart';
import '../data/playlist_import_repository.dart';
import 'widgets/downloads_management_section.dart';
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

final playlistImportClientProvider = Provider<PlaylistImportClient>((ref) {
  final httpClient = TuneFreeHttpClient();
  final controller = ref.watch(libraryControllerProvider);
  return TunehubPlaylistImportClient(
    httpClient: httpClient,
    apiBaseProvider: () => controller.state.apiBase,
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
  String? _selectedPlaylistId;
  bool _isEditMode = false;

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(libraryControllerProvider);
    final state = controller.state;
    final selectedPlaylist = _selectedPlaylist(state.playlists);

    if (!state.isLoaded) {
      return const Scaffold(
        backgroundColor: Color(0xFFF5F7FA),
        body: SafeArea(child: Center(child: CircularProgressIndicator())),
      );
    }

    return Scaffold(
      backgroundColor: const Color(0xFFF5F7FA),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 120),
          children: [
            const Text(
              '我的资料库',
              style: TextStyle(fontSize: 32, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 24),
            LibraryTabSwitcher(
              activeTab: _activeTab,
              onChanged: (tab) {
                setState(() {
                  _activeTab = tab;
                  _selectedPlaylistId = null;
                  _isEditMode = false;
                });
              },
            ),
            const SizedBox(height: 24),
            if (_activeTab == 'favorites')
              _FavoritesTab(
                state: state,
                onSongTap: (song) =>
                    _playSongQueue(song: song, queueSongs: state.favorites),
              ),
            if (_activeTab == 'playlists' && selectedPlaylist == null)
              _PlaylistsTab(
                playlists: state.playlists,
                onCreatePlaylist: _handleCreatePlaylist,
                onImportPlaylist: _handleImportPlaylist,
                onOpenPlaylist: (playlist) {
                  setState(() {
                    _selectedPlaylistId = playlist.id;
                    _isEditMode = false;
                  });
                },
              ),
            if (_activeTab == 'playlists' && selectedPlaylist != null)
              _PlaylistDetailTab(
                playlist: selectedPlaylist,
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
                onSongTap: (song) => _playSongQueue(
                  song: song,
                  queueSongs: selectedPlaylist.songs,
                ),
              ),
            if (_activeTab == 'manage')
              _ManageTab(
                state: state,
                controller: controller,
                backupTransfer: ref.watch(libraryBackupTransferProvider),
              ),
            if (_activeTab == 'about')
              _AboutTab(linkLauncher: ref.watch(aboutLinkLauncherProvider)),
          ],
        ),
      ),
    );
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
    final input = await _showImportPlaylistDialog();
    if (input == null) {
      return;
    }

    try {
      final result = await ref
          .read(playlistImportRepositoryProvider)
          .importPlaylist(source: input.$1, id: input.$2);
      if (result == null) {
        if (!mounted) {
          return;
        }
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(const SnackBar(content: Text('导入失败，请检查歌单信息')));
        return;
      }

      final playlist = await ref
          .read(libraryControllerProvider)
          .createPlaylist(result.$1, initialSongs: result.$2);
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('成功导入歌单「${playlist.name}」')));
    } catch (_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导入失败，请稍后重试')));
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
                    backgroundColor: const Color(0xFFE94B5B),
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

    await ref.read(libraryControllerProvider).deletePlaylist(playlist.id);
    if (!mounted) {
      return;
    }
    setState(() {
      _selectedPlaylistId = null;
      _isEditMode = false;
    });
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('歌单已删除')));
  }

  Future<void> _handleRemoveFromPlaylist(Playlist playlist, Song song) async {
    await ref
        .read(libraryControllerProvider)
        .removeFromPlaylist(playlist.id, song);
    if (!mounted) {
      return;
    }
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('已从歌单移除「${song.name}」')));
  }

  Future<void> _playSongQueue({
    required Song song,
    required List<Song> queueSongs,
  }) async {
    await ref
        .read(playerControllerProvider.notifier)
        .playSong(song, queue: List<Song>.unmodifiable(queueSongs));
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
                backgroundColor: const Color(0xFFE94B5B),
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
                    decoration: const InputDecoration(hintText: '输入歌单 ID'),
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
                    backgroundColor: const Color(0xFFE94B5B),
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

class _FavoritesTab extends StatelessWidget {
  const _FavoritesTab({required this.state, required this.onSongTap});

  final LibraryState state;
  final ValueChanged<Song> onSongTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(
              Icons.favorite_rounded,
              color: Color(0xFFE94B5B),
              size: 20,
            ),
            const SizedBox(width: 8),
            Text(
              '我喜欢的音乐 (${state.favorites.length})',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (state.favorites.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(
              child: Text(
                '暂无歌曲',
                style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
              ),
            ),
          )
        else
          ...state.favorites.map(
            (song) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: LibrarySongTile(song: song, onTap: () => onSongTap(song)),
            ),
          ),
      ],
    );
  }
}

class _PlaylistsTab extends StatelessWidget {
  const _PlaylistsTab({
    required this.playlists,
    required this.onCreatePlaylist,
    required this.onImportPlaylist,
    required this.onOpenPlaylist,
  });

  final List<Playlist> playlists;
  final Future<void> Function() onCreatePlaylist;
  final Future<void> Function() onImportPlaylist;
  final ValueChanged<Playlist> onOpenPlaylist;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _ActionPlaylistCard(
                cardKey: const Key('create-playlist-action'),
                icon: Icons.add_rounded,
                label: '新建歌单',
                borderColor: const Color(0xFFE5E7EB),
                foregroundColor: const Color(0xFF9CA3AF),
                onTap: onCreatePlaylist,
              ),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: _ActionPlaylistCard(
                cardKey: const Key('import-playlist-action'),
                icon: Icons.download_rounded,
                label: '导入在线歌单',
                borderColor: const Color(0x4DE94B5B),
                foregroundColor: const Color(0xFFE94B5B),
                onTap: onImportPlaylist,
              ),
            ),
          ],
        ),
        if (playlists.isNotEmpty) ...[
          const SizedBox(height: 16),
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
  final Future<void> Function() onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      key: cardKey,
      onTap: onTap,
      child: Container(
        height: 160,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: borderColor, width: 2),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, size: 32, color: foregroundColor),
            const SizedBox(height: 8),
            Text(
              label,
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: foregroundColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlaylistDetailTab extends StatelessWidget {
  const _PlaylistDetailTab({
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
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextButton.icon(
          onPressed: onBack,
          icon: const Icon(Icons.arrow_back_rounded, color: Color(0xFFE94B5B)),
          label: const Text(
            '返回歌单列表',
            style: TextStyle(
              color: Color(0xFFE94B5B),
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(24),
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
                            fontSize: 28,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '${playlist.songs.length} 首歌曲',
                          style: const TextStyle(
                            fontSize: 12,
                            color: Color(0xFF8B8B95),
                          ),
                        ),
                      ],
                    ),
                  ),
                  FilledButton.tonal(
                    key: const Key('playlist-edit-mode-button'),
                    onPressed: onToggleEditMode,
                    style: FilledButton.styleFrom(
                      backgroundColor: isEditMode
                          ? const Color(0xFFE94B5B)
                          : const Color(0xFFF3F4F6),
                      foregroundColor: isEditMode
                          ? Colors.white
                          : const Color(0xFFE94B5B),
                    ),
                    child: Text(isEditMode ? '完成' : '编辑'),
                  ),
                ],
              ),
              if (isEditMode) ...[
                const SizedBox(height: 16),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('playlist-rename-button'),
                        onPressed: onRenamePlaylist,
                        child: const Text('重命名'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.tonal(
                        key: const Key('playlist-delete-button'),
                        onPressed: onDeletePlaylist,
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0x1AE94B5B),
                          foregroundColor: const Color(0xFFE94B5B),
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
        const SizedBox(height: 16),
        if (playlist.songs.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(
              child: Text(
                '暂无歌曲',
                style: TextStyle(fontSize: 14, color: Color(0xFF9CA3AF)),
              ),
            ),
          )
        else
          ...playlist.songs.map(
            (song) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: LibrarySongTile(
                song: song,
                onTap: () => onSongTap(song),
                trailing: isEditMode
                    ? IconButton(
                        key: Key('playlist-remove-song-${song.key}'),
                        onPressed: () => onRemoveSong(song),
                        icon: const Icon(
                          Icons.delete_outline_rounded,
                          color: Color(0xFFE94B5B),
                        ),
                      )
                    : null,
              ),
            ),
          ),
      ],
    );
  }
}

class _ManageTab extends StatefulWidget {
  const _ManageTab({
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
  late final TextEditingController _apiKeyController;
  late final TextEditingController _apiBaseController;
  late final TextEditingController _proxyController;

  @override
  void initState() {
    super.initState();
    _apiKeyController = TextEditingController(text: widget.state.apiKey);
    _apiBaseController = TextEditingController(text: widget.state.apiBase);
    _proxyController = TextEditingController(text: widget.state.corsProxy);
  }

  @override
  void didUpdateWidget(covariant _ManageTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.state.apiKey != widget.state.apiKey) {
      _apiKeyController.text = widget.state.apiKey;
    }
    if (oldWidget.state.apiBase != widget.state.apiBase) {
      _apiBaseController.text = widget.state.apiBase;
    }
    if (oldWidget.state.corsProxy != widget.state.corsProxy) {
      _proxyController.text = widget.state.corsProxy;
    }
  }

  @override
  void dispose() {
    _apiKeyController.dispose();
    _apiBaseController.dispose();
    _proxyController.dispose();
    super.dispose();
  }

  Future<void> _handleExportJson(BuildContext context) async {
    try {
      final jsonText = await widget.controller.exportBackupJson();
      final fileName = _buildBackupFileName();
      await widget.backupTransfer.downloadJsonFile(
        fileName: fileName,
        content: jsonText,
      );
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
    }
  }

  Future<void> _handleImportJson(BuildContext context) async {
    try {
      final fileBytes = await widget.backupTransfer.pickJsonFileBytes();
      if (fileBytes == null) {
        return;
      }
      final rawJson = utf8.decode(fileBytes);
      await widget.controller.importBackupJson(rawJson);
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('备份数据已导入')));
    } on UnsupportedError catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('当前平台暂不支持导入备份文件')));
    } on FormatException catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导入失败，请检查 JSON 文件格式')));
    } catch (_) {
      if (!context.mounted) {
        return;
      }
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('导入失败，请稍后重试')));
    }
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
    return Column(
      children: [
        SettingsCard(
          title: '核心设置',
          icon: Icons.settings_rounded,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _SettingsField(
                label: 'TuneHub API Key',
                controller: _apiKeyController,
                hintText: 'th_xxxxxxxxxxxx',
                obscureText: true,
              ),
              const SizedBox(height: 16),
              _SettingsField(
                label: 'API Base URL',
                controller: _apiBaseController,
                hintText: 'https://api.tune-free.example',
              ),
              const SizedBox(height: 16),
              _SettingsField(
                label: 'CORS 代理 (可选)',
                controller: _proxyController,
                hintText: '留空使用内置代理（推荐）',
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () async {
                  await widget.controller.setApiKey(_apiKeyController.text);
                  await widget.controller.setApiBase(_apiBaseController.text);
                  await widget.controller.setCorsProxy(_proxyController.text);
                  if (!context.mounted) {
                    return;
                  }
                  ScaffoldMessenger.of(
                    context,
                  ).showSnackBar(const SnackBar(content: Text('设置已保存')));
                },
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFFE94B5B),
                  minimumSize: const Size(double.infinity, 48),
                ),
                child: const Text('保存配置'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        DownloadsManagementSection(
          downloads: widget.state.downloads,
          onDelete: (item) async {
            try {
              await widget.controller.deleteDownload(item);
              if (!context.mounted) {
                return;
              }
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(SnackBar(content: Text('已删除 ${item.songName}')));
            } catch (_) {
              if (!context.mounted) {
                return;
              }
              ScaffoldMessenger.of(
                context,
              ).showSnackBar(const SnackBar(content: Text('删除失败，请稍后重试')));
            }
          },
        ),
        const SizedBox(height: 16),
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
                      onTap: () => _handleExportJson(context),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _SecondaryActionButton(
                      buttonKey: const Key('library-import-data-button'),
                      label: '导入数据',
                      semanticsLabel: '选择备份文件导入数据',
                      onTap: () => _handleImportJson(context),
                    ),
                  ),
                ],
              ),
              if (widget.state.exportedBackupJson case final exportedJson?) ...[
                const SizedBox(height: 16),
                _BackupPreviewCard(
                  title: '最近导出',
                  previewLines: _buildPreviewLines(exportedJson),
                ),
              ],
              if (widget.state.lastImportSummary case final importSummary?) ...[
                const SizedBox(height: 16),
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
    this.obscureText = false,
  });

  final String label;
  final TextEditingController controller;
  final String hintText;
  final bool obscureText;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: Color(0xFF9CA3AF),
          ),
        ),
        const SizedBox(height: 6),
        TextField(
          controller: controller,
          obscureText: obscureText,
          decoration: InputDecoration(
            hintText: hintText,
            filled: true,
            fillColor: const Color(0xFFF9FAFB),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(16),
              borderSide: const BorderSide(color: Color(0xFFE5E7EB)),
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
  });

  final Key buttonKey;
  final String label;
  final VoidCallback onTap;
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semanticsLabel,
      button: true,
      child: FilledButton.tonal(
        key: buttonKey,
        onPressed: onTap,
        style: FilledButton.styleFrom(
          minimumSize: const Size(double.infinity, 44),
          backgroundColor: const Color(0xFFF3F4F6),
          foregroundColor: const Color(0xFF111111),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
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
                style: const TextStyle(fontSize: 12, color: Color(0xFF6B7280)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AboutTab extends StatelessWidget {
  const _AboutTab({required this.linkLauncher});

  final AboutLinkLauncher linkLauncher;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _AboutCard(
          child: Column(
            children: [
              SizedBox(height: 8),
              CircleAvatar(
                radius: 32,
                backgroundColor: Color(0x1AE94B5B),
                child: Icon(
                  Icons.music_note_rounded,
                  size: 32,
                  color: Color(0xFFE94B5B),
                ),
              ),
              SizedBox(height: 12),
              Text(
                'TuneFree Mobile',
                style: TextStyle(fontSize: 28, fontWeight: FontWeight.w700),
              ),
              SizedBox(height: 4),
              Text(
                '一个高颜值的现代化 PWA 音乐播放器',
                style: TextStyle(fontSize: 14, color: Color(0xFF6B7280)),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: 4),
              Text(
                'v1.2.0',
                style: TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const _AboutCard(
          title: '功能特性',
          child: Column(
            children: [
              _FeatureRow(
                index: '1',
                title: '多源聚合搜索',
                subtitle: '支持网易云、QQ音乐、酷我音乐，以及 JOOX、B站扩展音源',
              ),
              SizedBox(height: 12),
              _FeatureRow(
                index: '2',
                title: '无损音质播放',
                subtitle: '支持 128k / 320k / FLAC / Hi-Res',
              ),
              SizedBox(height: 12),
              _FeatureRow(
                index: '3',
                title: '实时音频可视化',
                subtitle: 'Canvas 绘制频谱动画 + 峰值指示器',
              ),
              SizedBox(height: 12),
              _FeatureRow(index: '4', title: '逐行滚动歌词', subtitle: '支持双语歌词翻译显示'),
              SizedBox(height: 12),
              _FeatureRow(
                index: '5',
                title: 'PWA 离线体验',
                subtitle: '添加到主屏幕，享受原生 App 体验',
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const _AboutCard(
          title: '技术栈',
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _TechChip(label: 'React 19'),
              _TechChip(label: 'TypeScript'),
              _TechChip(label: 'Tailwind CSS'),
              _TechChip(label: 'Vite'),
              _TechChip(label: 'Framer Motion'),
              _TechChip(label: 'Web Audio API'),
              _TechChip(label: 'Canvas'),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _AboutCard(
          title: '后端 API',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                '音乐数据服务由 TuneHub API 与 GD音乐台 (music.gdstudio.xyz) 共同提供。',
                style: TextStyle(
                  fontSize: 14,
                  color: Color(0xFF6B7280),
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 8),
              const Text(
                'TuneHub 负责原有解析链路；JOOX、B站等扩展音源走 GD Studio 公开接口，建议控制频率：5 分钟内不超过 50 次请求。',
                style: TextStyle(
                  fontSize: 12,
                  color: Color(0xFF9CA3AF),
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 12,
                runSpacing: 8,
                children: [
                  _InlineAboutLink(
                    title: 'TuneHub 原帖',
                    subtitle: 'linux.do/t/topic/1326425',
                    uri: Uri.parse('https://linux.do/t/topic/1326425'),
                    linkLauncher: linkLauncher,
                  ),
                  _InlineAboutLink(
                    title: 'GD音乐台',
                    subtitle: 'music.gdstudio.xyz',
                    uri: Uri.parse('https://music.gdstudio.xyz/'),
                    linkLauncher: linkLauncher,
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        _AboutCard(
          title: '链接',
          child: Column(
            children: [
              _LinkRow(
                title: '在线演示',
                subtitle: 'xilan.ccwu.cc',
                uri: Uri.parse('https://xilan.ccwu.cc/'),
                linkLauncher: linkLauncher,
              ),
              const SizedBox(height: 12),
              _LinkRow(
                title: 'GitHub 仓库',
                subtitle: 'alanbulan/musicxilan',
                uri: Uri.parse('https://github.com/alanbulan/musicxilan'),
                linkLauncher: linkLauncher,
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        const _DisclaimerCard(),
      ],
    );
  }
}

class _AboutCard extends StatelessWidget {
  const _AboutCard({this.title, required this.child});

  final String? title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 16),
          ],
          child,
        ],
      ),
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
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          index,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: Color(0xFFE94B5B),
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
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 12,
                  color: Color(0xFF9CA3AF),
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TechChip extends StatelessWidget {
  const _TechChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xFFF3F4F6),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 12, color: Color(0xFF4B5563)),
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
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: Key('about-link-$title'),
        borderRadius: BorderRadius.circular(16),
        onTap: () => linkLauncher.launch(uri),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFFF9FAFB),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              const Icon(
                Icons.open_in_new_rounded,
                size: 18,
                color: Color(0xFFE94B5B),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 12, color: Color(0xFF9CA3AF)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InlineAboutLink extends StatelessWidget {
  const _InlineAboutLink({
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
    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: Key('about-inline-link-$title'),
        borderRadius: BorderRadius.circular(999),
        onTap: () => linkLauncher.launch(uri),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: const Color(0xFFF9FAFB),
            borderRadius: BorderRadius.circular(999),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.open_in_new_rounded,
                size: 14,
                color: Color(0xFFE94B5B),
              ),
              const SizedBox(width: 6),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFFE94B5B),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 11, color: Color(0xFF9CA3AF)),
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
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFF9FAFB),
        borderRadius: BorderRadius.circular(24),
      ),
      child: const Column(
        children: [
          Text(
            '本项目仅供学习 React 及现代前端技术栈使用。音乐资源来源于第三方 API，本项目不存储任何音频文件。请支持正版音乐。',
            style: TextStyle(
              fontSize: 11,
              color: Color(0xFF9CA3AF),
              height: 1.6,
            ),
            textAlign: TextAlign.center,
          ),
          SizedBox(height: 8),
          Text(
            'MIT License © 2026 TuneFree',
            style: TextStyle(fontSize: 11, color: Color(0xFFD1D5DB)),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
