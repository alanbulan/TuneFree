import 'package:dio/dio.dart';

final class TuneFreeHttpClient {
  TuneFreeHttpClient({Dio? dio}) : dio = dio ?? Dio();

  final Dio dio;
}
