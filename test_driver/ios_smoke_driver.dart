import 'dart:io';

import 'package:integration_test/integration_test_driver_extended.dart';

Future<void> main() async {
  final destination =
      Platform.environment['IOS_PREVIEW_OUTPUT'] ??
      'build/ios-preview/screenshots';
  await Directory(destination).create(recursive: true);
  await integrationDriver(
    onScreenshot: (name, bytes, [arguments]) async {
      await File('$destination/$name.png').writeAsBytes(bytes, flush: true);
      return bytes.isNotEmpty;
    },
    responseDataCallback: (data) async {
      final summary = <String, dynamic>{...?data}..remove('screenshots');
      await writeResponseData(
        summary,
        destinationDirectory: destination,
        testOutputFilename: 'ios-smoke-result',
      );
    },
  );
}
