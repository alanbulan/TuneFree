import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/player/presentation/widgets/full_player_sheet.dart';
import '../../features/player/presentation/widgets/mini_player_bar.dart';
import '../../shared/theme/tune_free_palette.dart';
import '../../shared/theme/tune_free_spacing.dart';

class TuneFreeShell extends StatelessWidget {
  const TuneFreeShell({super.key, required this.child});

  final Widget child;

  static int _selectedIndex(String path) {
    if (path.startsWith('/search')) return 1;
    if (path.startsWith('/library')) return 2;
    return 0;
  }

  static void _onDestinationSelected(BuildContext context, int index) {
    switch (index) {
      case 0:
        context.go('/');
      case 1:
        context.go('/search');
      case 2:
        context.go('/library');
    }
  }

  @override
  Widget build(BuildContext context) {
    final path = GoRouterState.of(context).uri.path;
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return Scaffold(
      backgroundColor: TuneFreePalette.background,
      body: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(child: child),
          Positioned(
            left: TuneFreeSpacing.miniPlayerSideInset,
            right: TuneFreeSpacing.miniPlayerSideInset,
            bottom: bottomInset + TuneFreeSpacing.miniPlayerBottomOffset,
            child: const MiniPlayerBar(
              horizontalPadding: 0,
              bottomPadding: 0,
              useBottomSafeArea: false,
            ),
          ),
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: _ShellNavigationBar(
              selectedIndex: _selectedIndex(path),
              onDestinationSelected: (index) =>
                  _onDestinationSelected(context, index),
            ),
          ),
          const FullPlayerSheet(),
        ],
      ),
    );
  }
}

class _ShellNavigationBar extends StatelessWidget {
  const _ShellNavigationBar({
    required this.selectedIndex,
    required this.onDestinationSelected,
  });

  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;

  static const _items = [
    _ShellNavItemData(Icons.home_outlined, Icons.home_rounded, '首页'),
    _ShellNavItemData(Icons.search_rounded, Icons.search_rounded, '搜索'),
    _ShellNavItemData(
      Icons.library_music_outlined,
      Icons.library_music_rounded,
      '我的',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: DecoratedBox(
          key: const Key('shell-bottom-nav'),
          decoration: BoxDecoration(
            color: TuneFreePalette.surface.withValues(alpha: 0.76),
            border: Border(
              top: BorderSide(color: Colors.black.withValues(alpha: 0.05)),
            ),
          ),
          child: Padding(
            padding: EdgeInsets.only(bottom: bottomInset),
            child: SizedBox(
              height: TuneFreeSpacing.bottomNavHeight,
              child: Row(
                children: [
                  for (final entry in _items.indexed)
                    Expanded(
                      child: _ShellNavItem(
                        data: entry.$2,
                        selected: selectedIndex == entry.$1,
                        onTap: () => onDestinationSelected(entry.$1),
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

class _ShellNavItemData {
  const _ShellNavItemData(this.icon, this.selectedIcon, this.label);

  final IconData icon;
  final IconData selectedIcon;
  final String label;
}

class _ShellNavItem extends StatelessWidget {
  const _ShellNavItem({
    required this.data,
    required this.selected,
    required this.onTap,
  });

  final _ShellNavItemData data;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = selected
        ? TuneFreePalette.accent
        : TuneFreePalette.textSecondary;

    return Material(
      color: Colors.transparent,
      child: InkWell(
        key: Key('shell-nav-${data.label}'),
        onTap: onTap,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              selected ? data.selectedIcon : data.icon,
              size: 24,
              color: color,
            ),
            const SizedBox(height: 2),
            Text(
              data.label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: color,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
