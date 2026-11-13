import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../../../core/network/music_api_connection_tester.dart';
import '../../../../core/network/music_api_controller.dart';
import '../../../../core/network/music_api_settings.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import 'settings_card.dart';

/// 「音源」页签。检测使用草稿，保存成功后才更新正在使用的接口。
class MusicApiSettingsCard extends ConsumerStatefulWidget {
  const MusicApiSettingsCard({super.key});

  @override
  ConsumerState<MusicApiSettingsCard> createState() =>
      _MusicApiSettingsCardState();
}

enum _PendingAction { save, reset, musicTest, playlistTest }

class _MusicApiSettingsCardState extends ConsumerState<MusicApiSettingsCard> {
  final _formKey = GlobalKey<FormState>();
  final _musicController = TextEditingController();
  final _playlistController = TextEditingController();
  MusicApiRequestMode _mode = MusicApiRequestMode.gdSignedPost;
  bool _initialized = false;
  _PendingAction? _pending;
  String? _musicResult;
  String? _playlistResult;

  bool get _busy => _pending != null;

  void _setDraft(MusicApiSettings settings) {
    _musicController.text = settings.musicApiBase == defaultMusicApiBase
        ? ''
        : settings.musicApiBase;
    _playlistController.text =
        settings.playlistApiBase == defaultPlaylistApiBase
        ? ''
        : settings.playlistApiBase;
    _mode = settings.requestMode;
    _musicResult = null;
    _playlistResult = null;
  }

  @override
  void dispose() {
    _musicController.dispose();
    _playlistController.dispose();
    super.dispose();
  }

  MusicApiSettings _settingsFromFields() => MusicApiSettings.fromInput(
    musicApiBase: _musicController.text,
    playlistApiBase: _playlistController.text,
    requestMode: _mode,
  );

  bool _hasChanges(MusicApiSettings saved) {
    try {
      return _settingsFromFields() != saved;
    } on FormatException {
      return true;
    }
  }

  MusicApiSettings? _draft() {
    if (!(_formKey.currentState?.validate() ?? false)) return null;
    return _settingsFromFields();
  }

  Future<void> _save({bool reset = false}) async {
    final draft = reset ? const MusicApiSettings() : _draft();
    if (draft == null || _busy) return;
    FocusScope.of(context).unfocus();
    setState(
      () => _pending = reset ? _PendingAction.reset : _PendingAction.save,
    );
    try {
      await ref.read(musicApiControllerProvider.notifier).save(draft);
      if (!mounted) return;
      _formKey.currentState?.reset();
      _setDraft(draft);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(reset ? '已恢复默认音源' : '音源设置已保存，即刻生效')),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('保存失败，请重试')));
      }
    } finally {
      if (mounted) setState(() => _pending = null);
    }
  }

  Future<void> _test({required bool playlist}) async {
    final draft = _draft();
    if (draft == null || _busy) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _pending = playlist
          ? _PendingAction.playlistTest
          : _PendingAction.musicTest;
      if (playlist) {
        _playlistResult = null;
      } else {
        _musicResult = null;
      }
    });
    try {
      final tester = ref.read(musicApiConnectionTesterProvider);
      final result = await (playlist
          ? tester.testPlaylist(draft)
          : tester.testMusic(draft));
      if (mounted) {
        setState(() {
          if (playlist) {
            _playlistResult = result;
          } else {
            _musicResult = result;
          }
        });
      }
    } finally {
      if (mounted) setState(() => _pending = null);
    }
  }

  void _onMusicChanged(String _) => setState(() => _musicResult = null);
  void _onPlaylistChanged(String _) => setState(() => _playlistResult = null);

  @override
  Widget build(BuildContext context) {
    final controller = ref.watch(musicApiControllerProvider);
    final colors = TuneFreeColors.of(context);
    if (controller.isLoaded && !_initialized) {
      _setDraft(controller.settings);
      _initialized = true;
    }
    if (!controller.isLoaded) {
      return const SettingsCard(
        title: '音源设置',
        icon: Icons.headphones_rounded,
        child: Padding(
          padding: EdgeInsets.symmetric(vertical: 12),
          child: LinearProgressIndicator(),
        ),
      );
    }
    final changed = _hasChanges(controller.settings);
    final isCustom =
        controller.settings.usesCustomMusicApi ||
        controller.settings.playlistApiBase != defaultPlaylistApiBase;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: colors.surface,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    color: colors.accentSoft,
                    borderRadius: BorderRadius.circular(13),
                  ),
                  child: Icon(Icons.headphones_rounded, color: colors.accent),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '听见更多好音乐',
                        style: TextStyle(
                          color: colors.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        changed ? '正在编辑，保存后生效' : '选择你习惯的音乐服务',
                        style: TextStyle(
                          fontSize: 11,
                          color: colors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                _StatusBadge(
                  label: changed ? '未保存' : (isCustom ? '自定义' : '默认音源'),
                  highlighted: changed || isCustom,
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SettingsCard(
            title: '音乐接口',
            icon: Icons.cloud_outlined,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _Description('用于搜索、播放、歌词、封面与下载。'),
                const SizedBox(height: 14),
                _EndpointField(
                  fieldKey: const Key('music-api-url-field'),
                  controller: _musicController,
                  label: '接口地址',
                  defaultUrl: defaultMusicApiBase,
                  enabled: !_busy,
                  onChanged: _onMusicChanged,
                ),
                const SizedBox(height: 16),
                const _FieldLabel('连接方式'),
                const SizedBox(height: 8),
                Row(
                  children: [
                    for (final mode in MusicApiRequestMode.values) ...[
                      Expanded(
                        child: _ModeChoice(
                          key: Key('music-api-mode-${mode.name}'),
                          label: mode.label,
                          selected: _mode == mode,
                          onTap: _busy
                              ? null
                              : () => setState(() {
                                  _mode = mode;
                                  _musicResult = null;
                                }),
                        ),
                      ),
                      if (mode != MusicApiRequestMode.values.last)
                        const SizedBox(width: 8),
                    ],
                  ],
                ),
                const SizedBox(height: 10),
                _Description(
                  _mode == MusicApiRequestMode.gdSignedPost
                      ? 'GD 服务使用签名请求，连接时会自动校准时间。'
                      : '适用于兼容 api.php 的自建服务。',
                ),
                const SizedBox(height: 14),
                _ConnectionCheck(
                  buttonKey: const Key('music-api-test-button'),
                  resultKey: const Key('music-api-test-result'),
                  result: _musicResult,
                  testing: _pending == _PendingAction.musicTest,
                  onPressed: _busy ? null : () => _test(playlist: false),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          SettingsCard(
            title: '歌单接口',
            icon: Icons.queue_music_rounded,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const _Description('平台直连导入失败时，使用此接口补充。'),
                const SizedBox(height: 14),
                _EndpointField(
                  fieldKey: const Key('playlist-api-url-field'),
                  controller: _playlistController,
                  label: '接口地址',
                  defaultUrl: defaultPlaylistApiBase,
                  enabled: !_busy,
                  onChanged: _onPlaylistChanged,
                ),
                const SizedBox(height: 10),
                const _Description('支持 TuneHub 兼容服务，留空使用默认接口。'),
                const SizedBox(height: 14),
                _ConnectionCheck(
                  buttonKey: const Key('playlist-api-test-button'),
                  resultKey: const Key('playlist-api-test-result'),
                  result: _playlistResult,
                  testing: _pending == _PendingAction.playlistTest,
                  onPressed: _busy ? null : () => _test(playlist: true),
                ),
              ],
            ),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: FilledButton.tonal(
                  key: const Key('music-api-reset-button'),
                  onPressed: _busy ? null : () => _save(reset: true),
                  style: FilledButton.styleFrom(
                    backgroundColor: colors.surface,
                    foregroundColor: colors.textMuted,
                    minimumSize: const Size(0, 46),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                  child: Text(
                    _pending == _PendingAction.reset ? '恢复中…' : '恢复默认',
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: FilledButton.icon(
                  key: const Key('music-api-save-button'),
                  onPressed: _busy ? null : _save,
                  icon: _pending == _PendingAction.save
                      ? const SizedBox.square(
                          dimension: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.check_rounded, size: 18),
                  label: Text(
                    _pending == _PendingAction.save ? '保存中…' : '保存音源设置',
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: colors.accent,
                    foregroundColor: Colors.white,
                    minimumSize: const Size(0, 46),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(14),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            '检测使用当前填写的地址，不会修改已保存的音源。\n首页榜单继续由各音乐平台提供。',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: colors.textTertiary,
              fontSize: 11,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }
}

class _EndpointField extends StatelessWidget {
  const _EndpointField({
    required this.fieldKey,
    required this.controller,
    required this.label,
    required this.defaultUrl,
    required this.enabled,
    required this.onChanged,
  });

  final Key fieldKey;
  final TextEditingController controller;
  final String label;
  final String defaultUrl;
  final bool enabled;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    final useDefault =
        controller.text.trim().isEmpty || controller.text.trim() == defaultUrl;
    final border = OutlineInputBorder(
      borderRadius: BorderRadius.circular(12),
      borderSide: BorderSide.none,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(child: _FieldLabel(label)),
            _StatusBadge(
              label: useDefault ? '默认' : '自定义',
              highlighted: !useDefault,
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextFormField(
          key: fieldKey,
          controller: controller,
          enabled: enabled,
          style: TextStyle(fontSize: 12, color: colors.textPrimary),
          keyboardType: TextInputType.url,
          textInputAction: TextInputAction.done,
          autocorrect: false,
          enableSuggestions: false,
          onChanged: onChanged,
          validator: (value) => validateMusicApiUrl(value ?? ''),
          decoration: InputDecoration(
            hintText: defaultUrl,
            hintStyle: TextStyle(fontSize: 12, color: colors.textTertiary),
            filled: true,
            fillColor: colors.inputFill,
            border: border,
            enabledBorder: border,
            disabledBorder: border,
            focusedBorder: border.copyWith(
              borderSide: BorderSide(color: colors.accent, width: 1.2),
            ),
            errorBorder: border.copyWith(
              borderSide: BorderSide(color: colors.danger),
            ),
            focusedErrorBorder: border.copyWith(
              borderSide: BorderSide(color: colors.danger, width: 1.2),
            ),
            prefixIcon: Icon(
              Icons.link_rounded,
              size: 18,
              color: colors.textTertiary,
            ),
            prefixIconConstraints: const BoxConstraints(minWidth: 38),
            suffixIcon: controller.text.isEmpty
                ? null
                : IconButton(
                    tooltip: '使用默认地址',
                    icon: const Icon(Icons.close_rounded, size: 16),
                    color: colors.textTertiary,
                    onPressed: enabled
                        ? () {
                            controller.clear();
                            onChanged('');
                          }
                        : null,
                  ),
            isDense: true,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 15,
            ),
            errorMaxLines: 2,
          ),
        ),
      ],
    );
  }
}

class _ModeChoice extends StatelessWidget {
  const _ModeChoice({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Semantics(
      selected: selected,
      button: true,
      child: Material(
        color: selected ? colors.accentSoft : colors.fillSubtle,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 13),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (selected) ...[
                  Icon(Icons.check_rounded, size: 14, color: colors.accent),
                  const SizedBox(width: 5),
                ],
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: selected ? colors.accent : colors.textMuted,
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

class _ConnectionCheck extends StatelessWidget {
  const _ConnectionCheck({
    required this.buttonKey,
    required this.resultKey,
    required this.result,
    required this.testing,
    required this.onPressed,
  });

  final Key buttonKey;
  final Key resultKey;
  final String? result;
  final bool testing;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    final success = result?.endsWith('连接成功') ?? false;
    final foreground = result == null
        ? colors.textTertiary
        : (success ? colors.success : colors.danger);
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 4, 4, 4),
      decoration: BoxDecoration(
        color: result == null
            ? colors.fillFaint
            : (success
                  ? colors.success.withValues(alpha: 0.08)
                  : colors.dangerSoft),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          if (testing)
            SizedBox.square(
              dimension: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: colors.accent,
              ),
            )
          else
            Icon(
              result == null
                  ? Icons.wifi_tethering_rounded
                  : (success
                        ? Icons.check_circle_outline_rounded
                        : Icons.error_outline_rounded),
              size: 16,
              color: foreground,
            ),
          const SizedBox(width: 8),
          Expanded(
            child: Semantics(
              liveRegion: true,
              child: Text(
                testing ? '正在检测连接…' : (result ?? '尚未检测'),
                key: result == null ? null : resultKey,
                style: TextStyle(fontSize: 11, color: foreground, height: 1.5),
              ),
            ),
          ),
          TextButton(
            key: buttonKey,
            onPressed: onPressed,
            style: TextButton.styleFrom(
              foregroundColor: colors.accent,
              minimumSize: const Size(64, 40),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              textStyle: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: Text(testing ? '检测中' : (result == null ? '检测连接' : '重新检测')),
          ),
        ],
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.label, required this.highlighted});

  final String label;
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: highlighted ? colors.accentSoft : colors.fillSubtle,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w600,
          color: highlighted ? colors.accent : colors.textMuted,
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w600,
      color: TuneFreeColors.of(context).textMuted,
    ),
  );
}

class _Description extends StatelessWidget {
  const _Description(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Text(
    text,
    style: TextStyle(
      fontSize: 11,
      color: TuneFreeColors.of(context).textSecondary,
      height: 1.5,
    ),
  );
}
