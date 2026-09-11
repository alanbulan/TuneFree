import 'package:material_ui/material_ui.dart';

class PlayerBottomSheetTransition extends StatelessWidget {
  const PlayerBottomSheetTransition({
    super.key,
    required this.onClose,
    required this.child,
  });

  final VoidCallback onClose;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: TweenAnimationBuilder<double>(
        tween: Tween<double>(begin: 0, end: 1),
        duration: const Duration(milliseconds: 240),
        curve: Curves.easeOutCubic,
        builder: (context, value, child) {
          final backdropColor = Color.lerp(
            Colors.transparent,
            const Color(0x66000000),
            value,
          )!;
          return GestureDetector(
            onTap: onClose,
            child: ColoredBox(
              color: backdropColor,
              child: Align(
                alignment: Alignment.bottomCenter,
                child: Transform.translate(
                  offset: Offset(0, (1 - value) * 36),
                  child: Opacity(
                    opacity: value,
                    child: GestureDetector(onTap: () {}, child: child),
                  ),
                ),
              ),
            ),
          );
        },
        child: child,
      ),
    );
  }
}
