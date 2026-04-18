import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:golden_toolkit/golden_toolkit.dart';
import 'package:tunefree/shared/theme/tune_free_palette.dart';
import 'package:tunefree/shared/theme/tune_free_spacing.dart';
import 'package:tunefree/shared/theme/tune_free_text_styles.dart';
import 'package:tunefree/shared/widgets/tune_free_badge.dart';
import 'package:tunefree/shared/widgets/tune_free_card.dart';
import 'package:tunefree/shared/widgets/tune_free_loading_tile.dart';

import 'tune_free_golden_test_app.dart';

void main() {
  testGoldens('shared parity harness matches the reference golden', (tester) async {
    final homeReferenceBytes = File('test/shared/reference/home_reference.png').readAsBytesSync();
    final searchReferenceBytes = File('test/shared/reference/search_reference.png').readAsBytesSync();
    final playerReferenceBytes = File('test/shared/reference/player_reference.png').readAsBytesSync();

    await tester.pumpWidgetBuilder(
      TuneFreeGoldenTestApp(
        child: Align(
          alignment: Alignment.topCenter,
          child: RepaintBoundary(
            key: const Key('shared-theme-harness'),
            child: ColoredBox(
              color: TuneFreePalette.background,
              child: Padding(
                padding: const EdgeInsets.all(TuneFreeSpacing.page),
                child: SizedBox(
                  width: 420,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Shared theme parity', style: TuneFreeTextStyles.pageTitle),
                      const SizedBox(height: 8),
                      const Text(
                        'Legacy UI references and shared foundation widgets render together in one deterministic harness.',
                        style: TuneFreeTextStyles.body,
                      ),
                      const SizedBox(height: TuneFreeSpacing.section),
                      const Text('Legacy references', style: TuneFreeTextStyles.sectionTitle),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 12,
                        runSpacing: 12,
                        children: [
                          _ReferenceThumbnail(label: 'Home', bytes: homeReferenceBytes),
                          _ReferenceThumbnail(label: 'Search', bytes: searchReferenceBytes),
                          _ReferenceThumbnail(label: 'Player', bytes: playerReferenceBytes),
                        ],
                      ),
                      const SizedBox(height: TuneFreeSpacing.section),
                      const Text('Shared foundation sample', style: TuneFreeTextStyles.sectionTitle),
                      const SizedBox(height: 12),
                      TuneFreeCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Text('排行榜', style: TuneFreeTextStyles.sectionTitle),
                            const SizedBox(height: 8),
                            Row(
                              children: const [
                                TuneFreeBadge(
                                  text: 'NETEASE',
                                  background: Color(0x14E94B5B),
                                  foreground: TuneFreePalette.accent,
                                ),
                                SizedBox(width: 8),
                                TuneFreeBadge(
                                  text: '更新',
                                  background: Color(0xFFF0F1F5),
                                  foreground: TuneFreePalette.textSecondary,
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            const TuneFreeLoadingTile(),
                            const SizedBox(height: 12),
                            const Text(
                              'Surface tokens, spacing, and typography stay locked while feature pages are rebuilt separately.',
                              style: TuneFreeTextStyles.body,
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      surfaceSize: const Size(460, 1040),
    );

    await tester.pumpAndSettle();

    expect(find.byKey(const Key('shared-theme-harness')), findsOneWidget);
    await screenMatchesGolden(
      tester,
      'shared_theme_parity_harness',
      customPump: (tester) => tester.pump(),
    );
  });
}

class _ReferenceThumbnail extends StatelessWidget {
  const _ReferenceThumbnail({required this.label, required this.bytes});

  final String label;
  final Uint8List bytes;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 124,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TuneFreeTextStyles.body),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(TuneFreeSpacing.chipRadius),
            child: AspectRatio(
              aspectRatio: 272 / 529,
              child: Image.memory(bytes, fit: BoxFit.cover),
            ),
          ),
        ],
      ),
    );
  }
}
