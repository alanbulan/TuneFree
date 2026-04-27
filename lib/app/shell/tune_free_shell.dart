import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../features/player/presentation/widgets/full_player_sheet.dart';
import '../../features/player/presentation/widgets/mini_player_bar.dart';

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

    return Scaffold(
      body: SafeArea(
        bottom: false,
        child: Stack(
          fit: StackFit.expand,
          children: [
            Column(
              children: [
                Expanded(child: child),
                const MiniPlayerBar(useBottomSafeArea: false),
                _ShellNavigationBar(
                  selectedIndex: _selectedIndex(path),
                  onDestinationSelected: (index) => _onDestinationSelected(context, index),
                ),
              ],
            ),
            const FullPlayerSheet(),
          ],
        ),
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

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: NavigationBar(
        selectedIndex: selectedIndex,
        onDestinationSelected: onDestinationSelected,
        destinations: const [
          NavigationDestination(icon: Icon(Icons.home_outlined), label: '首页'),
          NavigationDestination(icon: Icon(Icons.search_rounded), label: '搜索'),
          NavigationDestination(icon: Icon(Icons.library_music_outlined), label: '我的'),
        ],
      ),
    );
  }
}
