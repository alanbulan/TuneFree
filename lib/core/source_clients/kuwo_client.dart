import '../models/song.dart';
import '../models/top_list.dart';

abstract class KuwoClient {
  Future<List<Song>> search(String keyword, int page);
  Future<List<TopList>> getTopLists();
  Future<List<Song>> getTopListDetail(String id);
}
