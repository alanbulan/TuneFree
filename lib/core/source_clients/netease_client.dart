import '../models/song.dart';
import '../models/top_list.dart';

abstract class NeteaseClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}
