import '../../../core/models/song.dart';
import '../../../core/models/top_list.dart';
import '../../../core/source_clients/kuwo_client.dart';
import '../../../core/source_clients/netease_client.dart';
import '../../../core/source_clients/qq_client.dart';

typedef TopListsLoader = Future<List<TopList>> Function();
typedef TopListDetailLoader = Future<List<Song>> Function(String id);

final class TopListRepository {
  TopListRepository({
    required NeteaseClient neteaseClient,
    required QqClient qqClient,
    required KuwoClient kuwoClient,
  }) : this.test(
         neteaseGetTopLists: neteaseClient.getTopLists,
         neteaseGetTopListDetail: neteaseClient.getTopListDetail,
         qqGetTopLists: qqClient.getTopLists,
         qqGetTopListDetail: qqClient.getTopListDetail,
         kuwoGetTopLists: kuwoClient.getTopLists,
         kuwoGetTopListDetail: kuwoClient.getTopListDetail,
       );

  TopListRepository.test({
    required TopListsLoader neteaseGetTopLists,
    required TopListDetailLoader neteaseGetTopListDetail,
    required TopListsLoader qqGetTopLists,
    required TopListDetailLoader qqGetTopListDetail,
    required TopListsLoader kuwoGetTopLists,
    required TopListDetailLoader kuwoGetTopListDetail,
  }) : _topListsBySource = <String, TopListsLoader>{
         'netease': neteaseGetTopLists,
         'qq': qqGetTopLists,
         'kuwo': kuwoGetTopLists,
       },
       _topListDetailBySource = <String, TopListDetailLoader>{
         'netease': neteaseGetTopListDetail,
         'qq': qqGetTopListDetail,
         'kuwo': kuwoGetTopListDetail,
       };

  final Map<String, TopListsLoader> _topListsBySource;
  final Map<String, TopListDetailLoader> _topListDetailBySource;

  Future<List<TopList>> getTopLists(String source) async {
    final loader = _topListsBySource[source];
    if (loader == null) {
      return const <TopList>[];
    }
    return loader();
  }

  Future<List<Song>> getTopListDetail(String source, String id) async {
    final loader = _topListDetailBySource[source];
    if (loader == null) {
      return const <Song>[];
    }
    return loader(id);
  }
}
