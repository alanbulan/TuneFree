import '../models/song.dart';

abstract class GdStudioClient {
  Future<List<Song>> search(String keyword, String source, int page);
}
