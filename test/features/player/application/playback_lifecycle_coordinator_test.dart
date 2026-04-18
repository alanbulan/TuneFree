import 'dart:async';

import 'package:audio_session/audio_session.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tunefree/features/player/application/media_session_remote_command.dart';
import 'package:tunefree/features/player/application/playback_lifecycle_coordinator.dart';

final class FakePlaybackLifecycleEventSource
    implements PlaybackLifecycleEventSource {
  final interruptionController =
      StreamController<AudioInterruptionEvent>.broadcast();
  final noisyController = StreamController<void>.broadcast();

  @override
  Stream<AudioInterruptionEvent> get interruptionEvents =>
      interruptionController.stream;

  @override
  Stream<void> get becomingNoisyEvents => noisyController.stream;
}

Future<void> pumpEventQueue() => Future<void>.delayed(Duration.zero);

void main() {
  test(
    'coordinator routes remote commands and only resumes after pausing active playback',
    () async {
      final remoteCommands =
          StreamController<MediaSessionRemoteCommand>.broadcast();
      final eventSource = FakePlaybackLifecycleEventSource();
      var playing = false;
      var playCalls = 0;
      var pauseCalls = 0;
      var stopCalls = 0;
      var nextCalls = 0;
      var previousCalls = 0;
      Duration? lastSeek;

      final coordinator = PlaybackLifecycleCoordinator(
        remoteCommands: remoteCommands.stream,
        eventSource: eventSource,
        isPlaying: () => playing,
        onPlay: () async {
          playCalls += 1;
          playing = true;
        },
        onPause: () async {
          pauseCalls += 1;
          playing = false;
        },
        onStop: () async {
          stopCalls += 1;
          playing = false;
        },
        onSkipNext: () async {
          nextCalls += 1;
        },
        onSkipPrevious: () async {
          previousCalls += 1;
        },
        onSeek: (position) async {
          lastSeek = position;
        },
      );
      addTearDown(coordinator.dispose);
      addTearDown(remoteCommands.close);
      addTearDown(eventSource.interruptionController.close);
      addTearDown(eventSource.noisyController.close);

      remoteCommands.add(const MediaSessionPlayCommand());
      remoteCommands.add(const MediaSessionSkipNextCommand());
      remoteCommands.add(const MediaSessionSeekCommand(Duration(seconds: 14)));
      await pumpEventQueue();

      expect(playCalls, 1);
      expect(nextCalls, 1);
      expect(lastSeek, const Duration(seconds: 14));

      playing = true;
      eventSource.interruptionController.add(
        AudioInterruptionEvent(true, AudioInterruptionType.pause),
      );
      await pumpEventQueue();
      expect(pauseCalls, 1);

      eventSource.interruptionController.add(
        AudioInterruptionEvent(false, AudioInterruptionType.pause),
      );
      await pumpEventQueue();
      expect(playCalls, 2);

      playing = false;
      eventSource.interruptionController.add(
        AudioInterruptionEvent(true, AudioInterruptionType.pause),
      );
      eventSource.interruptionController.add(
        AudioInterruptionEvent(false, AudioInterruptionType.pause),
      );
      await pumpEventQueue();
      expect(playCalls, 2);

      playing = true;
      eventSource.noisyController.add(null);
      await pumpEventQueue();
      expect(pauseCalls, 2);
      expect(stopCalls, 0);
      expect(previousCalls, 0);
    },
  );

  test('duck interruptions do not pause or resume playback', () async {
    final remoteCommands =
        StreamController<MediaSessionRemoteCommand>.broadcast();
    final eventSource = FakePlaybackLifecycleEventSource();
    var playing = true;
    var playCalls = 0;
    var pauseCalls = 0;

    final coordinator = PlaybackLifecycleCoordinator(
      remoteCommands: remoteCommands.stream,
      eventSource: eventSource,
      isPlaying: () => playing,
      onPlay: () async {
        playCalls += 1;
        playing = true;
      },
      onPause: () async {
        pauseCalls += 1;
        playing = false;
      },
      onStop: () async {},
      onSkipNext: () async {},
      onSkipPrevious: () async {},
      onSeek: (_) async {},
    );
    addTearDown(coordinator.dispose);
    addTearDown(remoteCommands.close);
    addTearDown(eventSource.interruptionController.close);
    addTearDown(eventSource.noisyController.close);

    eventSource.interruptionController.add(
      AudioInterruptionEvent(true, AudioInterruptionType.duck),
    );
    eventSource.interruptionController.add(
      AudioInterruptionEvent(false, AudioInterruptionType.duck),
    );
    await pumpEventQueue();

    expect(pauseCalls, 0);
    expect(playCalls, 0);
    expect(playing, true);
  });

  test('explicit remote pause cancels pending auto-resume', () async {
    final remoteCommands =
        StreamController<MediaSessionRemoteCommand>.broadcast();
    final eventSource = FakePlaybackLifecycleEventSource();
    var playing = true;
    var playCalls = 0;
    var pauseCalls = 0;

    final coordinator = PlaybackLifecycleCoordinator(
      remoteCommands: remoteCommands.stream,
      eventSource: eventSource,
      isPlaying: () => playing,
      onPlay: () async {
        playCalls += 1;
        playing = true;
      },
      onPause: () async {
        pauseCalls += 1;
        playing = false;
      },
      onStop: () async {
        playing = false;
      },
      onSkipNext: () async {},
      onSkipPrevious: () async {},
      onSeek: (_) async {},
    );
    addTearDown(coordinator.dispose);
    addTearDown(remoteCommands.close);
    addTearDown(eventSource.interruptionController.close);
    addTearDown(eventSource.noisyController.close);

    eventSource.interruptionController.add(
      AudioInterruptionEvent(true, AudioInterruptionType.pause),
    );
    remoteCommands.add(const MediaSessionPauseCommand());
    eventSource.interruptionController.add(
      AudioInterruptionEvent(false, AudioInterruptionType.pause),
    );
    await pumpEventQueue();

    expect(pauseCalls, 2);
    expect(playCalls, 0);
    expect(playing, false);
  });

  test('explicit remote stop cancels pending auto-resume', () async {
    final remoteCommands =
        StreamController<MediaSessionRemoteCommand>.broadcast();
    final eventSource = FakePlaybackLifecycleEventSource();
    var playing = true;
    var playCalls = 0;

    final coordinator = PlaybackLifecycleCoordinator(
      remoteCommands: remoteCommands.stream,
      eventSource: eventSource,
      isPlaying: () => playing,
      onPlay: () async {
        playCalls += 1;
        playing = true;
      },
      onPause: () async {
        playing = false;
      },
      onStop: () async {
        playing = false;
      },
      onSkipNext: () async {},
      onSkipPrevious: () async {},
      onSeek: (_) async {},
    );
    addTearDown(coordinator.dispose);
    addTearDown(remoteCommands.close);
    addTearDown(eventSource.interruptionController.close);
    addTearDown(eventSource.noisyController.close);

    eventSource.interruptionController.add(
      AudioInterruptionEvent(true, AudioInterruptionType.pause),
    );
    remoteCommands.add(const MediaSessionStopCommand());
    eventSource.interruptionController.add(
      AudioInterruptionEvent(false, AudioInterruptionType.pause),
    );
    await pumpEventQueue();

    expect(playCalls, 0);
    expect(playing, false);
  });

  test('dispose stops processing queued lifecycle events', () async {
    final remoteCommands =
        StreamController<MediaSessionRemoteCommand>.broadcast();
    final eventSource = FakePlaybackLifecycleEventSource();

    var playCalls = 0;
    final firstCommandStarted = Completer<void>();
    final firstCommandContinue = Completer<void>();

    final coordinator = PlaybackLifecycleCoordinator(
      remoteCommands: remoteCommands.stream,
      eventSource: eventSource,
      isPlaying: () => true,
      onPlay: () async {
        playCalls += 1;
        firstCommandStarted.complete();
        await firstCommandContinue.future;
      },
      onPause: () async {},
      onStop: () async {},
      onSkipNext: () async {},
      onSkipPrevious: () async {},
      onSeek: (_) async {},
    );
    addTearDown(remoteCommands.close);
    addTearDown(eventSource.interruptionController.close);
    addTearDown(eventSource.noisyController.close);

    remoteCommands.add(const MediaSessionPlayCommand());
    remoteCommands.add(const MediaSessionPlayCommand());

    await firstCommandStarted.future;
    await coordinator.dispose();
    firstCommandContinue.complete();

    await pumpEventQueue();

    expect(playCalls, 1);

    remoteCommands.add(const MediaSessionPlayCommand());
    await pumpEventQueue();

    expect(playCalls, 1);
  });
}
