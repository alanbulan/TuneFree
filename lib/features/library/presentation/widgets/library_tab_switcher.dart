import 'package:material_ui/material_ui.dart';

class LibraryTabSwitcher extends StatelessWidget {
  const LibraryTabSwitcher({
    super.key,
    required this.activeTab,
    required this.onChanged,
  });

  final String activeTab;
  final ValueChanged<String> onChanged;

  static const tabs = <String>['favorites', 'playlists', 'manage', 'about'];

  @override
  Widget build(BuildContext context) {
    final activeIndex = tabs.indexOf(activeTab).clamp(0, tabs.length - 1);

    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0x80E5E7EB),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Padding(
        padding: const EdgeInsets.all(3),
        child: LayoutBuilder(
          builder: (context, constraints) {
            final tabWidth = constraints.maxWidth / tabs.length;
            return SizedBox(
              height: 30,
              child: Stack(
                children: [
                  AnimatedPositioned(
                    duration: const Duration(milliseconds: 280),
                    curve: Curves.easeOutCubic,
                    left: activeIndex * tabWidth,
                    top: 0,
                    bottom: 0,
                    width: tabWidth,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(10),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.04),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Row(
                    children: tabs
                        .map((tab) {
                          final isActive = tab == activeTab;
                          final label = switch (tab) {
                            'favorites' => '收藏',
                            'playlists' => '歌单',
                            'manage' => '管理',
                            _ => '关于',
                          };
                          return Expanded(
                            child: GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () {
                                if (!isActive) {
                                  onChanged(tab);
                                }
                              },
                              child: Center(
                                child: AnimatedDefaultTextStyle(
                                  duration: const Duration(milliseconds: 180),
                                  curve: Curves.easeOutCubic,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                    color: isActive
                                        ? const Color(0xFF111111)
                                        : const Color(0xFF7B7D84),
                                  ),
                                  child: Text(
                                    label,
                                    textAlign: TextAlign.center,
                                  ),
                                ),
                              ),
                            ),
                          );
                        })
                        .toList(growable: false),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
