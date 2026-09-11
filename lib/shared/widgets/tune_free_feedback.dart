import 'dart:async';

import 'package:material_ui/material_ui.dart';

import '../theme/tune_free_palette.dart';

/// 提示条的语气，对应 Tauri `ToastHost` 的 `ToastTone`。
///
/// 语气只影响图标与图标颜色，不改底色 —— Flutter 的 SnackBar 底色由主题
/// 决定，动它会连带影响全 App 几十处既有提示，收益不值这个风险。
enum TuneFreeToastTone { info, success, warning, error }

/// 统一的提示条。
///
/// 刻意做成 `ScaffoldMessenger` 的**薄封装**而不是新的 overlay 层：
/// 全 App 已有几十处 `showSnackBar`，换一层就要连带改它们的行为、动画和
/// golden；这里只给「带撤销的提示」提供统一入口，其余照旧。
///
/// 与 Tauri 的一处差别：那边的 ToastHost 是**单槽**的，新 toast 顶掉旧的；
/// Flutter 的 ScaffoldMessenger 是排队。对撤销来说排队反而更安全 ——
/// 连做两次删除不会把第一条的退路冲掉。所以不刻意对齐。
void showToast(
  BuildContext context,
  String message, {
  TuneFreeToastTone tone = TuneFreeToastTone.info,
}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: TuneFreeToastContent(message: message, tone: tone)),
  );
}

/// 带撤销动作的提示条。
///
/// 停留时间比普通提示长（Tauri 是 3.2 秒 → 带动作 5.2 秒）：撤销是破坏性
/// 操作唯一的退路，一闪而过等于没有。
void showUndoToast(
  BuildContext context,
  String message, {
  required Future<void> Function() onUndo,
  String actionLabel = '撤销',
  Duration duration = const Duration(seconds: 5),
  TuneFreeToastTone tone = TuneFreeToastTone.info,
}) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(
      duration: duration,
      content: TuneFreeToastContent(message: message, tone: tone),
      action: SnackBarAction(
        label: actionLabel,
        onPressed: () {
          // 撤销回调要等用户点按钮才跑，那时发起操作的 widget 多半已经销毁，
          // 所以它只能依赖调用方事先捕获好的控制器 —— 这里不能再碰 context。
          // 失败也不能静默：撤销没生效而用户以为生效了，比报错更糟。
          unawaited(
            onUndo().catchError(
              (Object error, StackTrace stackTrace) =>
                  debugPrint('撤销失败: $error'),
            ),
          );
        },
      ),
    ),
  );
}

/// 提示条内容：语气图标 + 文案。
@visibleForTesting
class TuneFreeToastContent extends StatelessWidget {
  const TuneFreeToastContent({
    super.key,
    required this.message,
    this.tone = TuneFreeToastTone.info,
  });

  final String message;
  final TuneFreeToastTone tone;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return Row(
      children: [
        Icon(_icon, size: 18, color: _color(colors)),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: const TextStyle(fontSize: 13))),
      ],
    );
  }

  IconData get _icon => switch (tone) {
    TuneFreeToastTone.info => Icons.info_outline_rounded,
    TuneFreeToastTone.success => Icons.check_circle_outline_rounded,
    TuneFreeToastTone.warning => Icons.error_outline_rounded,
    TuneFreeToastTone.error => Icons.report_gmailerrorred_rounded,
  };

  Color _color(TuneFreeColors colors) => switch (tone) {
    TuneFreeToastTone.info => colors.textSecondary,
    TuneFreeToastTone.success => colors.success,
    TuneFreeToastTone.warning => colors.accent,
    TuneFreeToastTone.error => colors.danger,
  };
}
