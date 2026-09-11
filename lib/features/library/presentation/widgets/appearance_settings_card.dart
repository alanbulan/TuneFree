import 'package:material_ui/material_ui.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../shared/theme/appearance_controller.dart';
import '../../../../shared/theme/appearance_preferences.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import 'settings_card.dart';

/// 「外观」设置卡：主题模式、强调色、歌词字号与字体。
///
/// 独立成一个 `ConsumerWidget` 而不是塞进 `_ManageTab`：后者是普通
/// `StatefulWidget`，拿不到 `ref`。
class AppearanceSettingsCard extends ConsumerWidget {
  const AppearanceSettingsCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colors = TuneFreeColors.of(context);
    final controller = ref.watch(appearanceControllerProvider);
    final preferences = controller.preferences;

    return SettingsCard(
      title: '外观',
      icon: Icons.palette_outlined,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _FieldLabel('主题'),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final mode in ThemeModeSetting.values) ...[
                Expanded(
                  child: _ChoicePill(
                    key: Key('appearance-theme-${mode.storageValue}'),
                    label: mode.label,
                    selected: preferences.themeMode == mode,
                    onTap: () => controller.setThemeMode(mode),
                  ),
                ),
                if (mode != ThemeModeSetting.values.last)
                  const SizedBox(width: 8),
              ],
            ],
          ),
          const SizedBox(height: 18),
          const _FieldLabel('强调色'),
          const SizedBox(height: 10),
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: [
              for (final preset in kAccentPresets)
                _AccentSwatch(
                  key: Key('appearance-accent-${preset.hex}'),
                  preset: preset,
                  selected:
                      preferences.accentHex.toUpperCase() == preset.hex &&
                      preset.hex.isNotEmpty,
                  onTap: () => controller.setAccentHex(preset.hex),
                  borderColor: colors.borderSubtle,
                ),
            ],
          ),
          const SizedBox(height: 18),
          _FieldLabel('歌词字号  ${preferences.lyricSize}'),
          Slider(
            key: const Key('appearance-lyric-size-slider'),
            min: kMinLyricSize.toDouble(),
            max: kMaxLyricSize.toDouble(),
            divisions: kMaxLyricSize - kMinLyricSize,
            value: preferences.lyricSize.toDouble(),
            activeColor: colors.accent,
            onChanged: (value) => controller.setLyricSize(value.round()),
          ),
          const SizedBox(height: 6),
          const _FieldLabel('歌词字体'),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            key: const Key('appearance-lyric-font-dropdown'),
            initialValue: preferences.lyricFontId,
            isExpanded: true,
            decoration: const InputDecoration(
              isDense: true,
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
            ),
            items: <DropdownMenuItem<String>>[
              for (final option in kLyricFontOptions)
                DropdownMenuItem<String>(
                  value: option.id,
                  child: Text(option.label),
                ),
            ],
            onChanged: (value) {
              if (value != null) {
                controller.setLyricFontId(value);
              }
            },
          ),
        ],
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  const _FieldLabel(this.text);

  final String text;

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: TuneFreeColors.of(context).textTertiary,
      ),
    );
  }
}

class _ChoicePill extends StatelessWidget {
  const _ChoicePill({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 10),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? colors.accent : colors.fillSubtle,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: selected ? Colors.white : colors.textSecondary,
          ),
        ),
      ),
    );
  }
}

class _AccentSwatch extends StatelessWidget {
  const _AccentSwatch({
    super.key,
    required this.preset,
    required this.selected,
    required this.onTap,
    required this.borderColor,
  });

  final AccentPreset preset;
  final bool selected;
  final VoidCallback onTap;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: preset.label,
      selected: selected,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: Container(
          width: 34,
          height: 34,
          decoration: BoxDecoration(
            color: preset.color,
            shape: BoxShape.circle,
            border: Border.all(
              color: selected ? TuneFreeColors.of(context).textPrimary : borderColor,
              width: selected ? 2.5 : 1,
            ),
          ),
          child: selected
              ? const Icon(Icons.check_rounded, size: 16, color: Colors.white)
              : null,
        ),
      ),
    );
  }
}
