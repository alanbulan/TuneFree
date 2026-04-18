import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';

abstract class RemoteTopListRepository {
  Future<List<TopList>> getTopLists(String source);
  Future<List<Song>> getTopListDetail(String source, String id);
}
