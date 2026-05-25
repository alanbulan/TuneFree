import 'dart:math' as math;

import '../../../core/models/song.dart';

const String sequencePlayMode = 'sequence';
const String loopPlayMode = 'loop';
const String shufflePlayMode = 'shuffle';

String normalizePlayMode(String value) {
  return switch (value) {
    loopPlayMode => loopPlayMode,
    shufflePlayMode => shufflePlayMode,
    _ => sequencePlayMode,
  };
}

int getNextQueueIndex(List<Song> queue, Song? currentSong, String playMode) {
  if (queue.isEmpty) {
    return -1;
  }

  final currentIndex = _findCurrentIndex(queue, currentSong);
  if (currentIndex < 0) {
    return 0;
  }

  return switch (normalizePlayMode(playMode)) {
    shufflePlayMode => _randomQueueIndex(queue.length, currentIndex),
    _ when currentIndex + 1 >= queue.length => 0,
    _ => currentIndex + 1,
  };
}

int getPreviousQueueIndex(
  List<Song> queue,
  Song? currentSong,
  String playMode,
) {
  if (queue.isEmpty) {
    return -1;
  }

  final currentIndex = _findCurrentIndex(queue, currentSong);
  if (currentIndex < 0) {
    return 0;
  }

  return switch (normalizePlayMode(playMode)) {
    shufflePlayMode => _randomQueueIndex(queue.length, currentIndex),
    _ => currentIndex == 0 ? queue.length - 1 : currentIndex - 1,
  };
}

int _randomQueueIndex(int queueLength, int currentIndex) {
  if (queueLength <= 1) {
    return currentIndex;
  }

  var nextIndex = currentIndex;
  while (nextIndex == currentIndex) {
    nextIndex = math.Random().nextInt(queueLength);
  }
  return nextIndex;
}

int _findCurrentIndex(List<Song> queue, Song? currentSong) {
  if (currentSong == null) {
    return -1;
  }

  return queue.indexWhere((song) => song.key == currentSong.key);
}
