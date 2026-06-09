import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

import '../../../../core/models/song.dart';
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
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFF8B8B95),
                    ),
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
    final imageUrl = song.pic?.trim();
    final decoration = BoxDecoration(
      color: const Color(0xFFF0F1F5),
      borderRadius: BorderRadius.circular(10),
    );

    if (imageUrl == null || imageUrl.isEmpty) {
      return Container(
        key: Key('library-song-placeholder-${song.key}'),
        width: 44,
        height: 44,
        decoration: decoration,
        child: const Icon(Icons.music_note_rounded, color: Color(0xFFB6B8BF)),
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
            child: const Icon(
              Icons.music_note_rounded,
              color: Color(0xFFB6B8BF),
            ),
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
              leading: const Icon(
                Icons.share_rounded,
                color: Color(0xFFE94B5B),
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
  await Share.share(shareText, subject: text);
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
