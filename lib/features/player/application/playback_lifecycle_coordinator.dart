import 'dart:async';

import 'package:audio_session/audio_session.dart';
import 'package:flutter/foundation.dart';

import 'media_session_remote_command.dart';

abstract class PlaybackLifecycleEventSource {
  Stream<AudioInterruptionEvent> get interruptionEvents;
  Stream<void> get becomingNoisyEvents;
}

final class AudioSessionPlaybackLifecycleEventSource
    implements PlaybackLifecycleEventSource {
  @override
  Stream<AudioInterruptionEvent> get interruptionEvents async* {
    final session = await AudioSession.instance;
    yield* session.interruptionEventStream;
  }

  @override
  Stream<void> get becomingNoisyEvents async* {
    final session = await AudioSession.instance;
    await for (final _ in session.becomingNoisyEventStream) {
      yield null;
    }
  }
}

final class NoopPlaybackLifecycleEventSource
    implements PlaybackLifecycleEventSource {
  const NoopPlaybackLifecycleEventSource();

  @override
  Stream<AudioInterruptionEvent> get interruptionEvents =>
      const Stream<AudioInterruptionEvent>.empty();

  @override
  Stream<void> get becomingNoisyEvents => const Stream<void>.empty();
}

typedef PlaybackStateReader = bool Function();
typedef PlaybackAction = Future<void> Function();
typedef PlaybackSeekAction = Future<void> Function(Duration position);

final class PlaybackLifecycleCoordinator {
  PlaybackLifecycleCoordinator({
    required Stream<MediaSessionRemoteCommand> remoteCommands,
    required PlaybackLifecycleEventSource eventSource,
    required PlaybackStateReader isPlaying,
    required PlaybackAction onPlay,
    required PlaybackAction onPause,
    required PlaybackAction onStop,
    required PlaybackAction onSkipNext,
    required PlaybackAction onSkipPrevious,
    required PlaybackSeekAction onSeek,
  }) : _isPlaying = isPlaying,
       _onPlay = onPlay,
       _onPause = onPause,
       _onStop = onStop,
       _onSkipNext = onSkipNext,
       _onSkipPrevious = onSkipPrevious,
       _onSeek = onSeek {
    _subscriptions.addAll([
      remoteCommands.listen(
        (command) => _enqueue(() => _handleRemoteCommand(command)),
      ),
      eventSource.interruptionEvents.listen(
        (event) => _enqueue(() => _handleInterruptionEvent(event)),
      ),
      eventSource.becomingNoisyEvents.listen(
        (_) => _enqueue(() => _handleBecomingNoisy()),
      ),
    ]);
  }

  final PlaybackStateReader _isPlaying;
  final PlaybackAction _onPlay;
  final PlaybackAction _onPause;
  final PlaybackAction _onStop;
  final PlaybackAction _onSkipNext;
  final PlaybackAction _onSkipPrevious;
  final PlaybackSeekAction _onSeek;
  final List<StreamSubscription<dynamic>> _subscriptions =
      <StreamSubscription<dynamic>>[];

  final List<_QueuedEvent> _eventQueue = <_QueuedEvent>[];
  bool _isProcessingQueue = false;
  bool _disposeCalled = false;

  // For event ordering guarantees in Task 2 lifecycle handling.
  // Each event is queued and processed sequentially in order.

  bool _resumeAfterInterruption = false;

  void _enqueue(Future<void> Function() event) {
    if (_disposeCalled) {
      return;
    }

    _eventQueue.add(_QueuedEvent(run: event));
    unawaited(_processEventQueue());
  }

  Future<void> _processEventQueue() async {
    if (_isProcessingQueue) {
      return;
    }

    _isProcessingQueue = true;
    try {
      while (_eventQueue.isNotEmpty) {
        if (_disposeCalled) {
          _eventQueue.clear();
          return;
        }

        final event = _eventQueue.removeAt(0);
        await event.run();
      }
    } finally {
      _isProcessingQueue = false;
    }
  }

  Future<void> _handleRemoteCommand(MediaSessionRemoteCommand command) async {
    await _runGuarded(() async {
      switch (command) {
        case MediaSessionPlayCommand():
          await _onPlay();
        case MediaSessionPauseCommand():
          _resumeAfterInterruption = false;
          await _onPause();
        case MediaSessionStopCommand():
          _resumeAfterInterruption = false;
          await _onStop();
        case MediaSessionSkipNextCommand():
          await _onSkipNext();
        case MediaSessionSkipPreviousCommand():
          await _onSkipPrevious();
        case MediaSessionSeekCommand(position: final position):
          await _onSeek(position);
      }
    });
  }

  Future<void> _handleInterruptionEvent(AudioInterruptionEvent event) async {
    await _runGuarded(() async {
      if (event.begin) {
        if (!_isPlaying()) {
          _resumeAfterInterruption = false;
          return;
        }

        switch (event.type) {
          case AudioInterruptionType.pause:
          case AudioInterruptionType.unknown:
            _resumeAfterInterruption = true;
            await _onPause();
          case AudioInterruptionType.duck:
            break;
        }
        return;
      }

      if (!_isInterruptionTypeResumable(event.type)) {
        return;
      }

      if (_resumeAfterInterruption) {
        _resumeAfterInterruption = false;
        await _onPlay();
      }
    });
  }

  bool _isInterruptionTypeResumable(AudioInterruptionType type) {
    return type == AudioInterruptionType.pause ||
        type == AudioInterruptionType.unknown;
  }

  Future<void> _handleBecomingNoisy() async {
    await _runGuarded(() async {
      if (_isPlaying()) {
        _resumeAfterInterruption = false;
        await _onPause();
      }
    });
  }

  Future<void> _runGuarded(Future<void> Function() action) async {
    try {
      await action();
    } catch (error, stackTrace) {
      debugPrint('PlaybackLifecycleCoordinator failed: $error\n$stackTrace');
    }
  }

  Future<void> dispose() async {
    _disposeCalled = true;
    _eventQueue.clear();
    for (final subscription in _subscriptions) {
      await subscription.cancel();
    }
  }
}

final class _QueuedEvent {
  const _QueuedEvent({required this.run});

  final Future<void> Function() run;
}
