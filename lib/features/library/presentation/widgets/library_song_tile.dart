import 'package:flutter/material.dart';

import '../../../../core/models/song.dart';
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
      child: TuneFreeCard(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            _LibrarySongArtwork(song: song),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    song.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w500),
                  ),
                  Text(
                    song.artist,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 12, color: Color(0xFF8B8B95)),
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
      borderRadius: BorderRadius.circular(12),
    );

    if (imageUrl == null || imageUrl.isEmpty) {
      return Container(
        key: Key('library-song-placeholder-${song.key}'),
        width: 48,
        height: 48,
        decoration: decoration,
        child: const Icon(Icons.music_note_rounded, color: Color(0xFFB6B8BF)),
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Image.network(
        imageUrl,
        key: Key('library-song-artwork-${song.key}'),
        width: 48,
        height: 48,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) {
          return Container(
            key: Key('library-song-placeholder-${song.key}'),
            width: 48,
            height: 48,
            decoration: decoration,
            child: const Icon(Icons.music_note_rounded, color: Color(0xFFB6B8BF)),
          );
        },
      ),
    );
  }
}
