import 'package:material_ui/material_ui.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../core/models/song.dart';
import '../../../../shared/theme/tune_free_palette.dart';
import '../../../../shared/widgets/music_network_image.dart';
import '../../../../shared/widgets/tune_free_card.dart';

class LibrarySongTile extends StatelessWidget {
  const LibrarySongTile({
    super.key,
    required this.song,
    required this.onTap,
    this.trailing,
  });

  final Song song;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    return GestureDetector(
      onTap: onTap,
      onLongPress: () => _showShareSheet(context, song),
      child: TuneFreeCard(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            _LibrarySongArtwork(song: song),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    song.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  Text(
                    song.artist,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 11, color: colors.textSubtle),
                  ),
                ],
              ),
            ),
            ...(trailing == null ? const <Widget>[] : <Widget>[trailing!]),
          ],
        ),
      ),
    );
  }
}

class _LibrarySongArtwork extends StatelessWidget {
  const _LibrarySongArtwork({required this.song});

  final Song song;

  @override
  Widget build(BuildContext context) {
    final colors = TuneFreeColors.of(context);
    final imageUrl = song.pic?.trim();
    final decoration = BoxDecoration(
      color: colors.fillPanel,
      borderRadius: BorderRadius.circular(10),
    );

    if (imageUrl == null || imageUrl.isEmpty) {
      return Container(
        key: Key('library-song-placeholder-${song.key}'),
        width: 44,
        height: 44,
        decoration: decoration,
        child: Icon(Icons.music_note_rounded, color: colors.lyricInactive),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(10),
      child: MusicNetworkImage(
        imageUrl,
        key: Key('library-song-artwork-${song.key}'),
        width: 44,
        height: 44,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) {
          return Container(
            key: Key('library-song-placeholder-${song.key}'),
            width: 44,
            height: 44,
            decoration: decoration,
            child: Icon(Icons.music_note_rounded, color: colors.lyricInactive),
          );
        },
      ),
    );
  }
}

void _showShareSheet(BuildContext context, Song song) {
  showModalBottomSheet<void>(
    context: context,
    builder: (sheetContext) {
      return SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: Icon(
                Icons.share_rounded,
                color: TuneFreeColors.of(sheetContext).accent,
              ),
              title: const Text('分享歌曲'),
              subtitle: Text('${song.name} - ${song.artist}'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                _shareSong(song);
              },
            ),
          ],
        ),
      );
    },
  );
}

Future<void> _shareSong(Song song) async {
  final url = _songSourceUrl(song);
  final text = '${song.name} - ${song.artist}';
  final shareText = url != null ? '$text\n$url' : text;
  await SharePlus.instance.share(ShareParams(text: shareText, subject: text));
}

String? _songSourceUrl(Song song) {
  switch (song.source.wireValue) {
    case 'netease':
      return 'https://music.163.com/#/song?id=${song.id}';
    case 'qq':
      return 'https://y.qq.com/n/ryqq/songDetail/${song.id}';
    case 'kuwo':
      return 'https://www.kuwo.cn/play_detail/${song.id}';
    default:
      return null;
  }
}
