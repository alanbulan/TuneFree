import 'package:flutter/material.dart';

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
    return DecoratedBox(
      decoration: BoxDecoration(
        color: const Color(0x80E5E7EB),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Padding(
        padding: const EdgeInsets.all(4),
        child: Row(
          children: tabs.map((tab) {
            final isActive = tab == activeTab;
            final label = switch (tab) {
              'favorites' => '收藏',
              'playlists' => '歌单',
              'manage' => '管理',
              _ => '关于',
            };
            return Expanded(
              child: GestureDetector(
                onTap: () => onChanged(tab),
                child: Container(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    color: isActive ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: isActive ? const Color(0xFF111111) : const Color(0xFF7B7D84),
                    ),
                  ),
                ),
              ),
            );
          }).toList(growable: false),
        ),
      ),
    );
  }
}
