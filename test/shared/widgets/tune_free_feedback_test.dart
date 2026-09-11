import 'package:material_ui/material_ui.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/app/theme/app_theme.dart';
import 'package:tunefree/shared/widgets/tune_free_feedback.dart';

Widget _host({required VoidCallback onPressed}) {
  return MaterialApp(
    theme: buildTuneFreeTheme(
      brightness: Brightness.light,
      accent: const Color(0xFFFA233B),
    ),
    home: Scaffold(
      body: Builder(
        builder: (context) => Center(
          child: FilledButton(
            onPressed: onPressed,
            child: const SizedBox.shrink(),
          ),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('showToast renders the message and the tone icon', (
    tester,
  ) async {
    await tester.pumpWidget(_host(onPressed: () {}));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(FilledButton));
    showToast(context, '已删除', tone: TuneFreeToastTone.warning);
    // 必须等进场动画走完：pump() 不推进时钟，提示条还停在屏幕外，
    // 后面任何 tap 都会落在空处。
    await tester.pumpAndSettle();

    expect(find.text('已删除'), findsOneWidget);
    expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
    expect(find.text('撤销'), findsNothing);
  });

  testWidgets('showUndoToast runs the undo callback when tapped', (
    tester,
  ) async {
    var undone = false;
    await tester.pumpWidget(_host(onPressed: () {}));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(FilledButton));
    showUndoToast(
      context,
      '已删除歌单「测试」',
      tone: TuneFreeToastTone.warning,
      onUndo: () async {
        undone = true;
      },
    );
    await tester.pumpAndSettle();

    expect(find.text('已删除歌单「测试」'), findsOneWidget);
    expect(find.text('撤销'), findsOneWidget);

    await tester.tap(find.text('撤销'));
    await tester.pump();

    expect(undone, isTrue);
  });

  testWidgets('a failing undo callback does not take the app down', (
    tester,
  ) async {
    await tester.pumpWidget(_host(onPressed: () {}));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(FilledButton));
    showUndoToast(
      context,
      '已删除',
      onUndo: () async => throw StateError('storage gone'),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('撤销'));
    await tester.pump();
    await tester.pump();

    // 回调里的异常被吃掉并打了日志，测试不该因此失败。
    expect(tester.takeException(), isNull);
  });

  testWidgets('undo toasts ask for a longer dwell than the default', (
    tester,
  ) async {
    await tester.pumpWidget(_host(onPressed: () {}));
    await tester.pumpAndSettle();

    final context = tester.element(find.byType(FilledButton));
    showUndoToast(context, '已清空播放队列', onUndo: () async {});
    await tester.pumpAndSettle();

    // Flutter 默认 4 秒 —— 对「最后一次退路」来说太短。
    // 这里断言的是配置而不是真实消失时刻：后者由 ScaffoldMessenger 的
    // 进场/退场动画和定时器共同决定，测起来脆而且不是本模块的契约。
    final snackBar = tester.widget<SnackBar>(find.byType(SnackBar));
    expect(snackBar.duration, greaterThan(const Duration(seconds: 4)));
    expect(snackBar.action, isNotNull);
    expect(snackBar.action?.label, '撤销');
  });
}
