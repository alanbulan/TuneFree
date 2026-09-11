import 'package:material_ui/material_ui.dart';

import '../../../../shared/music_source_display.dart';

class TopSourceSwitcher extends StatelessWidget {
  const TopSourceSwitcher({
    super.key,
    required this.activeSource,
    required this.onChanged,
  });

  final String activeSource;
  final ValueChanged<String> onChanged;

  static const sources = <String>['netease', 'qq', 'kuwo'];

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0xFFE7E8ED),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Padding(
        padding: const EdgeInsets.all(2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: sources
              .map((source) {
                final isActive = source == activeSource;
                return GestureDetector(
                  onTap: () => onChanged(source),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: isActive ? Colors.white : Colors.transparent,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      musicSourceBadgeLabel(source),
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: isActive
                            ? Colors.black
                            : const Color(0xFF8C8F97),
                      ),
                    ),
                  ),
                );
              })
              .toList(growable: false),
        ),
      ),
    );
  }
}
