import '../models/song.dart';

abstract class TunehubClient {
  Future<List<Song>> importPlaylist(String source, String id);
}
